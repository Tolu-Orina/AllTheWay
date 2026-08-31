/**
 * Whether a labelled, mute guest notetaker may knock.
 *
 * The vendor is not signed. This module is the product contract: disclosure,
 * Meet-only, Max-only, never a unmute path. A BaaS key appearing later must
 * still pass these gates — that is the Phase 0 hole for the bot path.
 */

import { meetSpaceFromUrl } from "./speaker.js";

export const BOT_DISPLAY = "AllTheWay notes";
export const KNOCK_MS = 5 * 60_000;

/** Structural mute. There is no unmute function in this tree. */
export const BOT_MEDIA = {
  camera: "off",
  microphone: "muted",
  sendAudio: false,
  sendVideo: false,
} as const;

export type BotStatus = "idle" | "knocking" | "admitted" | "not_admitted" | "recording" | "ended";

export function botDisplayName(firstName?: string): string {
  const name = firstName?.trim();
  return name ? `${BOT_DISPLAY} · ${name}` : BOT_DISPLAY;
}

export function botChatLine(firstName?: string): string {
  const who = firstName?.trim() || "someone";
  return `I'm taking notes for ${who}. I cannot speak. Remove me if this call should not be recorded.`;
}

export type BotStartOk = {
  ok: true;
  displayName: string;
  chatLine: string;
  space: string;
};

export type BotStartNo = {
  ok: false;
  code: "undisclosed" | "not_meet" | "metered" | "vendor_pending";
  message: string;
};

export function decideBotStart(input: {
  disclosed: unknown;
  meetUrl: string;
  tier: string;
  vendorConfigured: boolean;
  firstName?: string;
}): BotStartOk | BotStartNo {
  if (input.disclosed !== true) {
    return {
      ok: false,
      code: "undisclosed",
      message: "Everyone in the room must be told before AllTheWay notes can join.",
    };
  }

  const space = meetSpaceFromUrl(input.meetUrl);
  if (!space) {
    return {
      ok: false,
      code: "not_meet",
      message: "The guest notetaker only joins Google Meet in this version.",
    };
  }

  if (input.tier !== "max") {
    return {
      ok: false,
      code: "metered",
      message: "Sending AllTheWay into the room is on Max. Notes from this tab still work.",
    };
  }

  if (!input.vendorConfigured) {
    return {
      ok: false,
      code: "vendor_pending",
      message:
        "Finance is still reviewing the join vendor. Nothing has joined this call. Notes from this tab still work.",
    };
  }

  return {
    ok: true,
    displayName: botDisplayName(input.firstName),
    chatLine: botChatLine(input.firstName),
    space,
  };
}

/**
 * Waiting-room clock. Meet's high-scrutiny queue times out around five
 * minutes; that miss is `not_admitted`, not a recording failure.
 */
export function knockOutcome(
  startedAtMs: number,
  nowMs: number,
  admitted: boolean,
): "knocking" | "admitted" | "not_admitted" {
  if (admitted) return "admitted";
  if (nowMs - startedAtMs >= KNOCK_MS) return "not_admitted";
  return "knocking";
}
