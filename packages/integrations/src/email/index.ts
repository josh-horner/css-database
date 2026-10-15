import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSendResult {
  provider: string;
  providerId: string | null;
  status: "sent" | "failed";
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export function createConsoleEmail(): EmailProvider {
  return {
    name: "console",
    async send({ to, subject, text }) {
      console.log(`[email] -> ${to}: ${subject}\n${text}\n`);
      return { provider: "console", providerId: null, status: "sent" };
    },
  };
}

export function createSesEmail(region: string, from: string): EmailProvider {
  const client = new SESv2Client({ region });
  return {
    name: "ses",
    async send({ to, subject, text, html }) {
      try {
        const out = await client.send(
          new SendEmailCommand({
            FromEmailAddress: from,
            Destination: { ToAddresses: [to] },
            Content: {
              Simple: {
                Subject: { Data: subject },
                Body: { Text: { Data: text }, ...(html ? { Html: { Data: html } } : {}) },
              },
            },
          }),
        );
        return { provider: "ses", providerId: out.MessageId ?? null, status: "sent" };
      } catch (err) {
        return { provider: "ses", providerId: null, status: "failed", error: (err as Error).message };
      }
    },
  };
}
