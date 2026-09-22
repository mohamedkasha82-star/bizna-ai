const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const buckets = new Map();

const ADVISOR_PROMPT = `You are Bizna Copilot, an expert Egyptian small-business advisor.
Speak in clear Egyptian Arabic by default, using simple practical language and EGP when money is involved.
Be specific, warm, and honest. Help micro-entrepreneurs turn uncertainty into one measurable next step.
Ask at most one clarifying question when necessary. Never invent market data, promise profit, or give legal/tax advice as certainty.
Prefer low-cost experiments, contribution margin, customer conversations, and evidence over generic motivation.
When recommending an experiment, include: hypothesis, action, metric, target, and timebox.`;

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
          "X-Title": "Bizna AI Copilot",
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
  const text = result.text || "أنا جاهز أساعدك. ابعتلي نوع مشروعك وأكبر حاجة معطلاك دلوقتي، ونحوّلها لأول تجربة بسيطة.";
  return response({ text, provider: result.provider }, 200, { "x-rate-limit-remaining": String(gate.remaining) });
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
    if (request.method === "POST" && url.pathname === "/api/ai/copilot") {
      try { return await copilot(request, env); } catch (error) { return response({ error: "copilot_failed", details: error?.message || "Unknown error" }, 500); }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return textResponse("Bizna AI");
  },
};

