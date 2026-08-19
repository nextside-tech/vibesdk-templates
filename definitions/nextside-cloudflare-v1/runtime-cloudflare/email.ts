export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export class IntegrationInactiveError extends Error {
  readonly code = 'INTEGRATION_INACTIVE';

  constructor() {
    super('email provider is not configured');
    this.name = 'IntegrationInactiveError';
  }
}

type EmailEnv = {
  ENVIRONMENT?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
};

export const isLocalEnvironment = (env: EmailEnv): boolean => env.ENVIRONMENT === 'local';

export const createEmailAdapter = (env: EmailEnv) => ({
  async send(message: EmailMessage): Promise<{ providerId: string; status: 'sent' | 'mocked' }> {
    if (isLocalEnvironment(env)) {
      return { providerId: `local-mock:${crypto.randomUUID()}`, status: 'mocked' };
    }

    const apiKey = env.RESEND_API_KEY?.trim();
    const from = env.RESEND_FROM?.trim();
    if (!apiKey || !from) throw new IntegrationInactiveError();

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!response.ok) {
      throw new Error(`resend_delivery_failed:${response.status}`);
    }
    const result = (await response.json()) as { id?: string };
    return { providerId: result.id ?? `resend:${crypto.randomUUID()}`, status: 'sent' };
  },
});
