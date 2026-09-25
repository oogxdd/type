import type { ModelCall, ModelResponse } from './brain';

type LiveSession = {session:{id:string}; transport:{type:string;sdp:string}};

export class OpenAIApi {
  constructor(private readonly apiKey = process.env.OPENAI_API_KEY ?? '',
    private readonly request: typeof fetch = fetch) {}

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.apiKey) throw new Error('Set OPENAI_API_KEY before starting the personal agent.');
    const response = await this.request(`https://api.openai.com/v1/${path}`, {
      method:'POST',
      headers:{'Authorization':`Bearer ${this.apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify(body), signal:signal ?? AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`OpenAI ${path} request failed (${response.status}).`);
    return response.json();
  }

  readonly respond: ModelCall = async (body, signal) => {
    const response = await this.post('responses',body,signal) as ModelResponse;
    if (!response || !Array.isArray(response.output) || typeof response.status !== 'string')
      throw new Error('OpenAI returned an invalid Responses result.');
    return response;
  };

  async createLiveSession(sdp: string, signal?: AbortSignal): Promise<LiveSession> {
    if (!sdp || sdp.length > 64_000) throw new Error('Invalid WebRTC offer.');
    const result = await this.post('live/sessions', {
      session: {
        model:'gpt-live-1', store:false,
        instructions:'Speak naturally and concisely in the user\'s language. Delegate requests about notes, reviews, remembered context, personal patterns, and changes to the backend. Delegate substantive new self-disclosures and corrections so the backend can decide whether to update memory. Ordinary greetings can stay in the voice conversation. Never imply a saved change succeeded until the backend confirms it. Ask for clarification when the user\'s words or intent are unclear.',
        delegation:{type:'client'},
      },
      transport:{type:'webrtc',sdp},
    }, signal) as LiveSession;
    if (typeof result?.session?.id !== 'string' || result.transport?.type !== 'webrtc' ||
      typeof result.transport?.sdp !== 'string') throw new Error('OpenAI returned an invalid Live session.');
    return {session:{id:result.session.id},transport:{type:'webrtc',sdp:result.transport.sdp}};
  }
}
