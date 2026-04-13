import Anthropic from '@anthropic-ai/sdk';
import type { AiExtractedJob, JobType } from '@quotebot/shared';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an AI assistant helping UK electricians generate job quotes.
Extract job details from a voice note transcript and return structured JSON.

Rules:
- All monetary estimates in pence (integer), never floating point
- Labour time in minutes (integer)
- Be conservative with estimates — it's better to leave fields empty than guess wildly
- If the trader mentions a customer name/phone/email, extract it
- Identify the primary job type from the enum values provided
- Return confidence 0-1 based on how complete the information is
- If anything is unclear, add questions to clarificationNeeded array

Job types: consumer_unit_replacement, socket_installation, light_installation, rewire_full,
rewire_partial, ev_charger, outdoor_lighting, fault_finding, pat_testing, eicr, other`;

export async function extractJobFromTranscript(transcript: string): Promise<AiExtractedJob> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Transcript: "${transcript}"

Return ONLY valid JSON matching this structure:
{
  "jobType": "<job_type_enum>",
  "summary": "<1-2 sentence job description>",
  "customerName": "<name or null>",
  "customerPhone": "<phone or null>",
  "customerEmail": "<email or null>",
  "jobAddress": "<address or null>",
  "lineItems": [
    {
      "description": "<item description>",
      "quantity": <number>,
      "unit": "<each|hour|m|lot>",
      "estimatedMaterialCostPence": <pence or null>,
      "labourMinutes": <minutes or null>,
      "notes": "<notes or null>"
    }
  ],
  "suggestedValidityDays": <number or null>,
  "urgency": "<normal|urgent|emergency>",
  "confidence": <0-1>,
  "clarificationNeeded": ["<question1>", ...]
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';

  // Strip markdown code fences if present
  const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    return JSON.parse(jsonStr) as AiExtractedJob;
  } catch {
    // Fallback with minimal structure if parsing fails
    return {
      jobType: 'other' as JobType,
      summary: transcript.substring(0, 200),
      lineItems: [],
      confidence: 0.1,
      clarificationNeeded: ['Could not parse job details — please review manually'],
    };
  }
}
