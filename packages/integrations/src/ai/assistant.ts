/**
 * First response to customer messages (docs/features/customer-communication.md).
 * The model answers only from the knowledge base and booking facts we pass in. It never changes bookings,
 * takes payments, or invents prices; anything else is escalated to the owner.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const INTENTS = [
  "where_when",
  "schedule_change",
  "billing",
  "packing_supplies",
  "pricing",
  "damage_or_claim",
  "complaint",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

export const AssistantReply = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().describe("0 to 1: how sure you are the reply fully and correctly answers the customer"),
  reply: z.string().describe("Text message to the customer. Plain text, friendly, under 320 characters."),
  escalate: z.boolean().describe("True when a person at CSS needs to handle this"),
  reason: z.string().nullable().describe("Why escalating, or null"),
  summary: z.string().describe("One line for the owner's inbox: what the customer needs"),
});
export type AssistantReply = z.infer<typeof AssistantReply>;

export interface KbArticle {
  title: string;
  body: string;
}

export interface AssistantInput {
  customerMessage: string;
  /** Oldest first. */
  history: { author: "customer" | "staff" | "ai" | "system"; body: string }[];
  /** Facts about the sender's bookings, computed by our code. Empty when the sender isn't verified. */
  bookingFacts: string[];
  verified: boolean;
  links: { label: string; url: string }[];
}

export interface CustomerAssistant {
  readonly model: string;
  readonly promptVersion: string;
  reply(input: AssistantInput, kb: readonly KbArticle[]): Promise<{ reply: AssistantReply; usage: unknown }>;
}

const PROMPT_VERSION = "customer-sms-v1";

function systemPrompt(kb: readonly KbArticle[]): string {
  return [
    "You answer text messages for College Student Storage (CSS), a Boulder, Colorado storage, moving, and shipping company for college students.",
    "Your job: answer routine questions so the owner only handles real problems.",
    "",
    "Rules:",
    "- Answer only from the knowledge base below and the booking facts in the message. If the answer isn't there, say a person will follow up, and escalate.",
    "- Never change a booking, take a payment, promise a refund or credit, or quote a price that isn't in the knowledge base. Offer the provided links instead.",
    "- Escalate damage, missing items, complaints, anything urgent, and anything you're unsure about. Confidence below 0.7 means escalate.",
    "- If the sender isn't verified, don't reveal booking details; answer general questions only.",
    "- Keep replies short enough for a text message. No markdown.",
    "",
    "Knowledge base:",
    ...kb.map((a) => `## ${a.title}\n${a.body}`),
  ].join("\n");
}

function userPrompt(input: AssistantInput): string {
  const parts = [
    `Sender verified: ${input.verified ? "yes" : "no"}`,
    "",
    "Booking facts (current, from our system):",
    ...(input.bookingFacts.length ? input.bookingFacts.map((f) => `- ${f}`) : ["- none available"]),
    "",
    "Links you may share:",
    ...(input.links.length ? input.links.map((l) => `- ${l.label}: ${l.url}`) : ["- none"]),
    "",
    "Conversation so far:",
    ...(input.history.length ? input.history.map((m) => `${m.author}: ${m.body}`) : ["(none)"]),
    "",
    `New message from the customer: ${input.customerMessage}`,
  ];
  return parts.join("\n");
}

export function createClaudeAssistant(apiKey: string, model: string): CustomerAssistant {
  const client = new Anthropic({ apiKey });
  return {
    model,
    promptVersion: PROMPT_VERSION,
    async reply(input, kb) {
      const response = await client.messages.parse({
        model,
        max_tokens: 4000,
        output_config: { effort: "low", format: zodOutputFormat(AssistantReply) },
        system: [{ type: "text", text: systemPrompt(kb), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt(input) }],
      });
      if (response.stop_reason === "refusal" || !response.parsed_output) {
        return {
          reply: {
            intent: "other",
            confidence: 0,
            reply: "Thanks for your message! Someone from CSS will get back to you shortly.",
            escalate: true,
            reason: `No usable model output (stop_reason: ${response.stop_reason})`,
            summary: input.customerMessage.slice(0, 120),
          },
          usage: response.usage,
        };
      }
      return { reply: response.parsed_output, usage: response.usage };
    },
  };
}

/** Keyword stand-in for development without an API key. Good enough to demo the flow. */
export function createFakeAssistant(): CustomerAssistant {
  return {
    model: "fake",
    promptVersion: PROMPT_VERSION,
    async reply(input) {
      const text = input.customerMessage.toLowerCase();
      const eta = input.bookingFacts.find((f) => f.startsWith("Queue:"));
      if (/(where|when|eta|how long|coming|arriv)/.test(text) && input.verified && eta) {
        return {
          reply: {
            intent: "where_when",
            confidence: 0.9,
            reply: `${eta.replace("Queue: ", "")} Live tracking: ${input.links.find((l) => l.label === "Tracking")?.url ?? ""}`.trim(),
            escalate: false,
            reason: null,
            summary: "Asked when the crew will arrive",
          },
          usage: null,
        };
      }
      return {
        reply: {
          intent: /(damag|broke|missing|lost)/.test(text) ? "damage_or_claim" : "other",
          confidence: 0.3,
          reply: "Thanks for your message! Someone from CSS will get back to you shortly.",
          escalate: true,
          reason: "Not a routine question",
          summary: input.customerMessage.slice(0, 120),
        },
        usage: null,
      };
    },
  };
}
