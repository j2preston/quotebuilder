import OpenAI from 'openai';
import { createReadStream } from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribeAudio(filePath: string): Promise<string> {
  const transcription = await openai.audio.transcriptions.create({
    file: createReadStream(filePath),
    model: 'whisper-1',
    language: 'en',
    response_format: 'text',
  });
  return transcription as unknown as string;
}

export async function transcribeBuffer(
  buffer: Buffer,
  filename: string,
  mimetype: string
): Promise<string> {
  // openai SDK accepts a File-like object
  const file = new File([buffer], filename, { type: mimetype });

  const transcription = await openai.audio.transcriptions.create({
    file: file as Parameters<typeof openai.audio.transcriptions.create>[0]['file'],
    model: 'whisper-1',
    language: 'en',
    response_format: 'text',
  });
  return transcription as unknown as string;
}
