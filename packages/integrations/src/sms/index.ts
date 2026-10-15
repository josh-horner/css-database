import twilio from "twilio";

export interface SmsSendResult {
  provider: string;
  providerId: string | null;
  status: "sent" | "failed";
  error?: string;
}

export interface SmsProvider {
  readonly name: string;
  readonly fromNumber: string;
  send(to: string, body: string): Promise<SmsSendResult>;
}

export function createConsoleSms(fromNumber = "+15555550100"): SmsProvider {
  return {
    name: "console",
    fromNumber,
    async send(to, body) {
      console.log(`[sms] ${fromNumber} -> ${to}: ${body}`);
      return { provider: "console", providerId: null, status: "sent" };
    },
  };
}

export function createTwilioSms(accountSid: string, authToken: string, fromNumber: string): SmsProvider {
  const client = twilio(accountSid, authToken);
  return {
    name: "twilio",
    fromNumber,
    async send(to, body) {
      try {
        const msg = await client.messages.create({ to, from: fromNumber, body });
        return { provider: "twilio", providerId: msg.sid, status: "sent" };
      } catch (err) {
        return { provider: "twilio", providerId: null, status: "failed", error: (err as Error).message };
      }
    },
  };
}

/** Verifies Twilio's X-Twilio-Signature on inbound webhooks. */
export function verifyTwilioSignature(authToken: string, signature: string, url: string, params: Record<string, string>): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}
