const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const buckets = new Map();

const ADVISOR_PROMPT = `You are Nubia AI, a careful cultural intelligence guide for Nubia, the Nile Valley, and its living communities.
Answer in clear Arabic by default, with English names in parentheses when useful. Be warm, precise, and respectful.
Explain historical eras, places, language preservation, and cultural context without flattening Nubian identity into a museum object.
Never invent a translation, date, lineage, photograph, or oral-history detail. If a claim is uncertain, say so and suggest what kind of community or archival source should verify it.
Do not present family-memory text as independently verified history. Prefer context, questions for further research, and responsible storytelling over confident filler.
When asked about a village or person, distinguish documented history, community memory, and the user's own archive.`;

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function serveAssets(request, env, url) {
  const asset = await env.ASSETS.fetch(request);
  if (request.method !== "GET" || !["/", "/index.html"].includes(url.pathname)) return asset;
  const headers = new Headers(asset.headers);
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("pragma", "no-cache");
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
}

function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "anonymous";
}

async function rateLimit(request, env) {
  const key = `copilot:${clientKey(request)}`;
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 20;

  if (env.RATE_LIMIT_KV) {
    const stored = (await env.RATE_LIMIT_KV.get(key, { type: "json" })) || { count: 0, reset: now + windowMs };
    const next = stored.reset <= now ? { count: 1, reset: now + windowMs } : { count: stored.count + 1, reset: stored.reset };
    if (next.count > limit) return { ok: false, retryAfter: Math.ceil((next.reset - now) / 1000) };
    await env.RATE_LIMIT_KV.put(key, JSON.stringify(next), { expirationTtl: Math.ceil((next.reset - now) / 1000) });
    return { ok: true, remaining: limit - next.count };
  }

  const current = buckets.get(key);
  const next = !current || current.reset <= now ? { count: 1, reset: now + windowMs } : { count: current.count + 1, reset: current.reset };
  buckets.set(key, next);
  if (next.count > limit) return { ok: false, retryAfter: Math.ceil((next.reset - now) / 1000) };
  return { ok: true, remaining: limit - next.count };
}

function cleanMessages(messages, context = "") {
  const list = Array.isArray(messages) ? messages : [];
  const safe = list.slice(-12).map((message) => ({
    role: message?.role === "assistant" ? "assistant" : "user",
    content: String(message?.content || "").slice(0, 2400),
  }));
  if (context) safe.unshift({ role: "system", content: `Current business context:\n${String(context).slice(0, 1800)}` });
  return [{ role: "system", content: ADVISOR_PROMPT }, ...safe];
}

function extractText(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  return payload.response || payload.output_text || payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text || "";
}

async function runCompletion(env, messages, maxTokens = 700) {
  const attempts = [];

  if (env.AI?.run) {
    attempts.push(async () => extractText(await env.AI.run("@cf/meta/llama-3-8b-instruct", { messages, max_tokens: maxTokens })));
  }

  if (env.GROQ_API_KEY) {
    attempts.push(async () => {
      const result = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: env.GROQ_MODEL || "llama-3.1-8b-instant", messages, temperature: 0.35, max_tokens: maxTokens }),
      });
      if (!result.ok) throw new Error(`Groq ${result.status}`);
      return extractText(await result.json());
    });
  }

  if (env.OPENROUTER_API_KEY) {
    attempts.push(async () => {
      const result = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "content-type": "application/json",
          "HTTP-Referer": env.OPENROUTER_SITE || "https://bizna-ai.mohamedkasha82.workers.dev",
          "X-Title": "Nubia AI Copilot",
        },
        body: JSON.stringify({ model: env.OPENROUTER_MODEL || "meta-llama/llama-3-8b-instruct:free", messages, temperature: 0.35, max_tokens: maxTokens }),
      });
      if (!result.ok) throw new Error(`OpenRouter ${result.status}`);
      return extractText(await result.json());
    });
  }

  for (const attempt of attempts) {
    try {
      const text = await attempt();
      if (text) return { text, provider: "live" };
    } catch (error) {
      console.warn("AI provider failed", error?.message || error);
    }
  }
  return { text: "", provider: "fallback" };
}

function fallbackDiagnosis(business) {
  const price = Number(business.price) || 0;
  const cost = Number(business.unit_cost) || 0;
  const orders = Number(business.monthly_orders) || 0;
  const margin = price ? Math.round(((price - cost) / price) * 100) : 0;
  const bottleneck = margin < 25 ? "Revenue" : (business.problem || "Customer");
  const lowMargin = margin < 25;
  return {
    primary_bottleneck: bottleneck,
    diagnosis: lowMargin ? "الهامش الحالي ضيق، لذلك كل طلب جديد لا يترجم بالضرورة إلى ربح صحي." : "الخطوة الأهم الآن هي تحويل المشكلة الحالية إلى تجربة صغيرة لها مقياس واضح.",
    next_best_action: lowMargin ? "اختبر عرضاً بهامش أفضل على 10 عملاء قبل زيادة الإنفاق على التسويق." : "تحدث مع 5 عملاء محتملين هذا الأسبوع وسجل سبب الشراء أو التردد حرفياً.",
    experiment: {
      hypothesis: lowMargin ? "رفع قيمة السلة أو خفض تكلفة الوحدة سيحسن الربح لكل طلب." : "رسالة عرض أكثر وضوحاً ستزيد التحويل من سؤال إلى شراء.",
      action: lowMargin ? "اعرض باقة صغيرة أو إضافة مدفوعة على 10 طلبات." : "اختبر رسالتين للبيع على نفس الجمهور لمدة 7 أيام.",
      metric: lowMargin ? "هامش الربح لكل طلب" : "نسبة التحويل إلى شراء",
      target: lowMargin ? `${Math.max(margin + 10, 30)}%` : "+20%",
      timebox: "7 أيام",
    },
    marketing_ideas: ["انشر نتيجة أو تجربة حقيقية بدل منشور عام.", "اطلب من عميل سابق ترشيح شخص واحد مناسب."],
    sales_script: "أهلاً، لو هدفك [النتيجة] أقدر أساعدك بـ[العرض]. تحب نبدأ بالخيار الأنسب لاحتياجك؟",
    unknowns: ["ما أكثر سبب يجعل العميل يتردد؟", "أي عرض يحقق أفضل هامش؟"],
    provider: "fallback",
  };
}

function parseJson(text) {
  try { return JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()); } catch { return null; }
}

function fallbackNubiaAnswer(messages = [], context = "") {
  const latest = [...messages].reverse().find((message) => message?.role === "user")?.content || "";
  const query = `${latest} ${context}`.toLowerCase();
  const entries = [
    { keys: ["مروي", "meroe"], text: "مروي كانت عاصمة مهمة في المرحلة المتأخرة من مملكة كوش، وازدهرت تقريباً من القرن الثالث قبل الميلاد إلى القرن الرابع الميلادي. ترتبط بمراكز حضرية، وصناعة الحديد، ومقابر هرمية، وبالخط المرويتي الذي ما زالت قراءته الكاملة مجالاً للبحث. الأفضل أن نعرض تاريخها كإنجاز كوشي قائم بذاته، لا كملحق بتاريخ مصر فقط." },
    { keys: ["كرمة", "kerma"], text: "كرمة من أقدم المراكز الحضرية والسياسية الكبرى في وادي النيل، وازدهرت تقريباً بين 2500 و1500 قبل الميلاد. الدفوفة الغربية والمقابر واللقى الأثرية تذكّرنا بأن الدولة والمجتمع في النوبة القديمة امتلكا بنية سياسية وثقافية خاصة بهما." },
    { keys: ["نبتة", "napata", "الأسرة الخامسة والعشرون", "25th"], text: "نبتة كانت مركزاً سياسياً ودينياً مهماً في تاريخ كوش، ومنها وصل الحكم الكوشي إلى الأسرة الخامسة والعشرين في مصر خلال القرن الثامن قبل الميلاد. عند الحديث عنها، من المهم إبراز حركة القوة جنوباً وشمالاً معاً، لا اختزالها في فكرة السيطرة وحدها." },
    { keys: ["اندان", "أندان", "andan"], text: "أندان اسم حاضر في خريطة الذاكرة النوبية، وتتعامل معه هذه المنصة كمنارة تكريم لا كبيانات مكتملة من دون أصحابها. أي تاريخ عائلي أو رواية عن المكان يجب أن يُراجع مع أهل القرية والأرشيفات التي يوافقون على مشاركتها." },
    { keys: ["توماس", "thomas"], text: "توماس تظهر هنا كمنارة ثانية في الرحلة، والاسم يحمل قيمة عاطفية ومكانية لا ينبغي أن تُملأ بتفاصيل غير موثقة. يمكن أن نبدأ بسؤال: أي صورة أو شهادة أو اسم عائلة تريد أن تحفظه قبل أن نضيف سرداً تاريخياً؟" },
    { keys: ["البقط", "baqt"], text: "البقط اسم المعاهدة التي ارتبطت بالعلاقات بين المقرة والقوى العربية في القرن السابع الميلادي، ويُؤرخ لها عادةً بعامي 651 و652. قصتها ليست حدوداً عسكرية فقط؛ هي أيضاً نافذة على التجارة والتفاوض والتعايش والتوتر عبر النهر." },
    { keys: ["مقُرة", "makuria", "نوباتيا", "nobatia", "علوة", "alodia"], text: "الممالك النوبية المسيحية، ومنها نوباتيا ومقُرة وعلوة، شكّلت زمناً طويلاً من الفن والعمارة والكتابة والسياسة على امتداد وادي النيل. التفاصيل تختلف بين المملكة والموقع، لذلك سأفصل بين ما هو موثق أثرياً وما يحتاج إلى رواية مجتمعية أو مصدر متخصص." },
    { keys: ["اللغة", "nobiin", "نوبيين", "كنزي", "لغة نوبية"], text: "اللغات النوبية لغات حية، وحفظها لا يقتصر على تسجيل كلمات منفردة. يحتاج الأمر إلى متحدثين، وسياق عائلي، ونطق، وحق المجتمع في تحديد ما يُنشر وما يبقى داخل الدائرة المحلية. بطاقة الأرشيف هنا بداية سؤال، وليست بديلاً عن أهل اللغة." },
    { keys: ["التهجير", "إعادة التوطين", "السد", "resettlement"], text: "مشروعات السدود، خصوصاً في القرن العشرين، أعادت تشكيل جغرافيا قرى نوبية كثيرة ودفعت مجتمعات إلى إعادة التوطين. لا توجد رواية واحدة تختصر التجربة؛ الذاكرة تشمل الفقد، وإعادة بناء البيوت، واستمرار اللغة والروابط العائلية." },
    { keys: ["النيل", "nile", "فلوكة", "felucca"], text: "النيل في الذاكرة النوبية ليس خلفية طبيعية فقط؛ هو طريق حركة، ومصدر رزق، وحدّ عائلي، ومخزن أسماء وحكايات. عند قراءة أي قرية، اسأل كيف تغيّر الوصول إلى الماء، وكيف تغيّرت الأسماء والبيوت، وما الذي بقي في الأغاني واللغة." },
  ];
  const hit = entries.find((entry) => entry.keys.some((key) => query.includes(key.toLowerCase())));
  return { text: hit?.text || "أقدر أبدأ معك من مروي، كرمة، أندان، اللغة النوبية، أو تاريخ إعادة التوطين. اكتب اسماً واحداً وسأفصل بين التاريخ الموثق، والذاكرة المجتمعية، وما يحتاج إلى بحث إضافي.", provider: "knowledge-fallback" };
}

async function diagnose(request, env) {
  const business = await request.json();
  const instruction = `Return JSON only with keys primary_bottleneck, diagnosis, next_best_action, experiment (hypothesis, action, metric, target, timebox), marketing_ideas (array), sales_script, unknowns (array). Business:\n${JSON.stringify(business)}`;
  const result = await runCompletion(env, cleanMessages([{ role: "user", content: instruction }]), 850);
  const parsed = parseJson(result.text);
  return response(parsed ? { ...parsed, provider: result.provider } : fallbackDiagnosis(business));
}

async function copilot(request, env) {
  const gate = await rateLimit(request, env);
  if (!gate.ok) return response({ error: "rate_limited", message: "خد نفس وجرب تاني بعد شوية.", retryAfter: gate.retryAfter }, 429, { "retry-after": String(gate.retryAfter) });
  const body = await request.json();
  const result = await runCompletion(env, cleanMessages(body.messages, body.context), 700);
  const fallback = fallbackNubiaAnswer(body.messages, body.context);
  const text = result.text || fallback.text;
  return response({ text, provider: result.text ? result.provider : fallback.provider }, 200, { "x-rate-limit-remaining": String(gate.remaining) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/config") {
      return response({ supabaseUrl: env.SUPABASE_URL || "", supabaseAnonKey: env.SUPABASE_ANON_KEY || "" });
    }
    if (request.method === "POST" && url.pathname === "/api/ai/diagnose") {
      try { return await diagnose(request, env); } catch (error) { return response({ error: "diagnosis_failed", details: error?.message || "Unknown error" }, 500); }
    }
    if (request.method === "POST" && (url.pathname === "/api/ai/copilot" || url.pathname === "/api/ai/nubia")) {
      try { return await copilot(request, env); } catch (error) { return response({ error: "copilot_failed", details: error?.message || "Unknown error" }, 500); }
    }
    if (env.ASSETS) return serveAssets(request, env, url);
    return textResponse("Nubia AI");
  },
};
