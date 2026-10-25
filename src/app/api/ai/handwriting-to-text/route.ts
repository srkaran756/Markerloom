import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { image, apiKey, model: requestedModel, testOnly } = body;

    const groqKey = (apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0)
      ? apiKey.trim()
      : process.env.GROQ_API_KEY?.trim();

    if (!groqKey) {
      return NextResponse.json(
        {
          error: 'MISSING_API_KEY',
          message:
            'Groq API Key is not configured. Please enter your Groq API key in the settings dialog or add GROQ_API_KEY to .env.local',
        },
        { status: 400 }
      );
    }

    // Connection test mode
    if (testOnly) {
      try {
        const testRes = await fetch('https://api.groq.com/openai/v1/models', {
          headers: {
            Authorization: `Bearer ${groqKey}`,
          },
        });
        if (!testRes.ok) {
          const err = await testRes.json().catch(() => ({}));
          return NextResponse.json(
            { error: 'INVALID_KEY', message: err?.error?.message || `Invalid Groq API Key (HTTP ${testRes.status})` },
            { status: 401 }
          );
        }
        const modelsData = await testRes.json().catch(() => ({}));
        const allModels = Array.isArray(modelsData?.data)
          ? modelsData.data.map((m: { id?: string }) => m.id).filter(Boolean)
          : [];
        return NextResponse.json({
          success: true,
          message: 'Groq API Key verified successfully!',
          availableModels: allModels,
        });
      } catch (err: unknown) {
        return NextResponse.json(
          { error: 'CONNECTION_FAILED', message: err instanceof Error ? err.message : 'Failed to connect to Groq API' },
          { status: 500 }
        );
      }
    }

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: 'No stroke image data provided.' },
        { status: 400 }
      );
    }

    // Ensure data URL format
    const formattedImageUrl = image.startsWith('data:image')
      ? image
      : `data:image/png;base64,${image}`;

    const promptText = `You are an expert handwriting transcriber for educational whiteboards.
Transcribe all handwritten words, sentences, or math equations in this whiteboard image.
Instructions:
1. Return ONLY the transcribed text or equations exactly as written.
2. Preserve original capitalization, punctuation, and multi-line formatting.
3. If handwriting contains mathematical symbols, algebra, or fractions, format them cleanly using standard math notation or LaTeX (e.g., ax² + bx + c = 0, or x = (-b ± √(b² - 4ac)) / (2a)).
4. DO NOT include explanations, commentary, or markdown code blocks. Return purely the transcribed content.`;

    // Active vision models supported on Groq (Llama-3.2 vision previews were decommissioned by Groq)
    const activeVisionModels = [
      'qwen/qwen3.8-27b',
      'qwen/qwen3.6-27b',
      'meta-models/muse-spark-open',
      'meta-llama/llama-4-scout-17b-preview',
      'meta-llama/llama-4-scout-70b-preview',
    ];

    // Build model list to attempt, avoiding decommissioned llama-3.2 vision IDs
    const candidateModels: string[] = [];
    if (
      requestedModel &&
      typeof requestedModel === 'string' &&
      !requestedModel.includes('llama-3.2-11b-vision') &&
      !requestedModel.includes('llama-3.2-90b-vision')
    ) {
      candidateModels.push(requestedModel);
    }
    for (const m of activeVisionModels) {
      if (!candidateModels.includes(m)) {
        candidateModels.push(m);
      }
    }

    let lastError: string | null = null;
    let transcribedText = '';
    let modelUsed = '';

    for (const model of candidateModels) {
      try {
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText },
                  {
                    type: 'image_url',
                    image_url: {
                      url: formattedImageUrl,
                    },
                  },
                ],
              },
            ],
            temperature: 0.1,
            max_tokens: 512,
            max_completion_tokens: 512,
          }),
        });

        if (!groqResponse.ok) {
          const errData = await groqResponse.json().catch(() => ({}));
          lastError = errData?.error?.message || `Groq API returned HTTP ${groqResponse.status}`;
          continue;
        }

        const data = await groqResponse.json();
        let content = data?.choices?.[0]?.message?.content || '';

        // Strip accidental markdown code blocks if present
        content = content.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();

        if (content) {
          transcribedText = content;
          modelUsed = model;
          break;
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : 'Network request to Groq failed.';
      }
    }

    if (!transcribedText) {
      return NextResponse.json(
        {
          error: 'TRANSCRIPTION_FAILED',
          message: lastError || 'Failed to transcribe handwriting using Groq Vision API.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ text: transcribedText, model: modelUsed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { error: 'SERVER_ERROR', message },
      { status: 500 }
    );
  }
}
