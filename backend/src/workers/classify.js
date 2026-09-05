import Groq from 'groq-sdk';
import { config } from '../config/env.js';
import { EVENT_CATEGORIES, SEVERITIES } from '../schema/logSchema.js';

let client = null;

function getClient() {
  if (!client) {
    if (!config.llm.apiKey) {
      throw new Error(
        'LLM_API_KEY is not set. Get a free key at https://console.groq.com/keys ' +
          'and add it to backend/.env as LLM_API_KEY.'
      );
    }
    client = new Groq({ apiKey: config.llm.apiKey });
  }
  return client;
}

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `You are a log-parsing engine for raw Linux system log lines
(format: "Mon DD HH:MM:SS host process[pid]: message"; note dates can be malformed,
e.g. missing leading zeros or occasional garbage — do your best).

For each input line, extract:
- timestamp: the raw timestamp string as it appears, or null if unparseable
- host: the hostname, or null
- process: the process/service name (without the [pid] part), or null
- pid: the numeric process id, or null if absent
- event_category: exactly one of ${JSON.stringify(EVENT_CATEGORIES)}
- severity: exactly one of ${JSON.stringify(SEVERITIES)}
- summary: a short (under 200 char) plain-English gloss of what happened
- entities.remote_host: an IP or hostname mentioned in the message (e.g. "rhost=..."), or null
- entities.user: a username mentioned in the message, or null

Respond with ONLY a JSON object of the shape {"results": [ ... ]} where "results" is
an array with exactly one object per input line, in the same order as given. Do not
include any text outside the JSON object.`;

async function callGroq(rawLines) {
  const groq = getClient();
  const numbered = rawLines.map((line, i) => `${i + 1}. ${line}`).join('\n');

  const completion = await groq.chat.completions.create({
    model: config.llm.model || DEFAULT_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Extract structured fields from these ${rawLines.length} raw log lines. Return exactly ${rawLines.length} results, in order:\n\n${numbered}`,
      },
    ],
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Groq returned an empty response');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Groq response was not valid JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed.results)) {
    throw new Error('Groq response JSON did not contain a "results" array');
  }

  return parsed.results;
}

/**
 * @param {string[]} rawLines
 * @returns {Promise<object[]>} raw (not-yet-validated) extraction objects,
 *   one per input line, in order — validated downstream by schema/logSchema.js
 */
export async function classifyBatch(rawLines) {
  return callGroq(rawLines);
}
