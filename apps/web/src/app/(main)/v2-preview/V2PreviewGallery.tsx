"use client";

/**
 * V2PreviewGallery — the interactive half of `/v2-preview` (see `page.tsx`
 * for why this route exists and its posture). Renders V2 unconditionally
 * via `PeakV2Shell`'s own `data-ui-version="v2"` self-attribute, so this
 * page proves the design system regardless of the ambient `?ui=` value.
 *
 * Every name/value below is clearly sample data for demonstrating a
 * primitive's STATES — never a real PEAK3 statistic.
 */

import { useState } from "react";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2CinematicStage from "@/components/v2/PeakV2CinematicStage";
import PeakV2ResultHeadline from "@/components/v2/PeakV2ResultHeadline";
import PeakV2Rule from "@/components/v2/PeakV2Rule";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import PeakV2Timer from "@/components/v2/PeakV2Timer";
import PeakV2Score from "@/components/v2/PeakV2Score";
import PeakV2PlayerIdentity from "@/components/v2/PeakV2PlayerIdentity";
import PeakV2DataLane from "@/components/v2/PeakV2DataLane";
import PeakV2GameStatus from "@/components/v2/PeakV2GameStatus";
import PeakV2Modal from "@/components/v2/PeakV2Modal";
import PeakV2ArenaLight from "@/components/v2/PeakV2ArenaLight";
import PeakV2LiveHeader from "@/components/v2/PeakV2LiveHeader";
import PeakV2CourtSlot from "@/components/v2/PeakV2CourtSlot";
import { V2_COMPONENT_TONES, V2_COMPONENT_TONE_LABELS } from "@/components/v2/v2-tone";

function GallerySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-8">
      <h2
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--v2-text-muted)",
          margin: "0 0 1rem",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function V2PreviewGallery() {
  const [modalOpen, setModalOpen] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(5);

  return (
    <PeakV2Shell width="live" className="pb-24">
      <header className="pt-10">
        <p
          style={{
            fontFamily: "var(--v2-font-mono)",
            fontSize: "0.75rem",
            color: "var(--v2-text-muted)",
          }}
        >
          Internal — not part of the product
        </p>
        <h1
          style={{
            fontFamily: "var(--v2-font-display)",
            fontSize: "2.5rem",
            color: "var(--v2-text-primary)",
          }}
        >
          PEAK3 V2 · Broadcast Arena
        </h1>
        <p style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)", maxWidth: "60ch" }}>
          Component gallery for the V2 foundation pass. Every value below is sample data for
          demonstrating primitive states, not a real PEAK3 statistic.
        </p>
      </header>

      <GallerySection title="Typography — three roles">
        <div className="flex flex-col gap-4">
          <div>
            <div style={{ fontFamily: "var(--v2-font-display)", fontSize: "2rem", color: "var(--v2-text-primary)" }}>
              The Wall
            </div>
            <div style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
              1. DISPLAY / MOMENT — Instrument Serif, cinematic only
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "1.25rem", color: "var(--v2-text-primary)" }}>
              Nikola Jokić
            </div>
            <div style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
              2. UI / PLAYER IDENTITY — Space Grotesk
            </div>
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--v2-font-mono)",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 700,
                fontSize: "1.5rem",
                color: "var(--v2-text-primary)",
              }}
            >
              07 : 10
            </div>
            <div style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
              3. INSTRUMENTATION — system mono, tabular figures
            </div>
          </div>
        </div>
      </GallerySection>

      <PeakV2Rule />

      <GallerySection title="Color — five components + gold, never decorative">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {V2_COMPONENT_TONES.map((tone) => (
            <PeakV2Score key={tone} value="—" label={V2_COMPONENT_TONE_LABELS[tone]} tone={tone} />
          ))}
        </div>
      </GallerySection>

      <PeakV2Rule />

      <GallerySection title="Arena light — one controlled source">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(["soft", "focus"] as const).map((intensity) => (
            <div
              key={intensity}
              className="relative overflow-hidden"
              style={{
                height: 140,
                borderRadius: "var(--v2-radius-control)",
                border: "1px solid var(--v2-border-subtle)",
              }}
            >
              <PeakV2ArenaLight intensity={intensity} pulse={intensity === "focus"} />
              <span
                className="relative"
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 8,
                  fontFamily: "var(--v2-font-mono)",
                  fontSize: "0.6875rem",
                  color: "var(--v2-text-muted)",
                }}
              >
                {intensity}
              </span>
            </div>
          ))}
          <div
            className="relative overflow-hidden"
            style={{ height: 140, borderRadius: "var(--v2-radius-control)", border: "1px solid var(--v2-border-subtle)" }}
          >
            <PeakV2ArenaLight tone="si" intensity="focus" />
            <span
              style={{
                position: "absolute",
                bottom: 8,
                left: 8,
                fontFamily: "var(--v2-font-mono)",
                fontSize: "0.6875rem",
                color: "var(--v2-text-muted)",
              }}
            >
              tone=si (only when lighting real component data)
            </span>
          </div>
        </div>
      </GallerySection>

      <PeakV2Rule />

      <GallerySection title="Actions">
        <div className="flex flex-wrap items-center gap-3">
          <PeakV2PrimaryAction>Draft Player</PeakV2PrimaryAction>
          <PeakV2PrimaryAction busy>Submitting…</PeakV2PrimaryAction>
          <PeakV2PrimaryAction disabled>Disabled</PeakV2PrimaryAction>
          <PeakV2SecondaryAction>Change Selection</PeakV2SecondaryAction>
          <PeakV2PrimaryAction href="/v2-preview" size="sm">
            As a link
          </PeakV2PrimaryAction>
        </div>
      </GallerySection>

      <PeakV2Rule />

      <GallerySection title="Instrumentation — Timer / Score">
        <div className="flex flex-wrap items-center gap-8">
          <PeakV2Timer secondsRemaining={timerSeconds} urgentAtSeconds={3} label="Pick clock" size="lg" />
          <PeakV2SecondaryAction
            size="sm"
            onClick={() => setTimerSeconds((s) => (s > 0 ? s - 1 : 5))}
          >
            Tick
          </PeakV2SecondaryAction>
          <PeakV2Score value="$7" label="Current bid" tone="accent" />
          <PeakV2Score value="18.4" label="Lineup rating" size="lg" />
        </div>
      </GallerySection>

      <PeakV2Rule />

      <GallerySection title="Player identity + status">
        <div className="flex flex-wrap items-start gap-10">
          <PeakV2PlayerIdentity name="Sample Player A" meta="Sample Team · 2010s" position="PG" state="current" />
          <PeakV2PlayerIdentity name="Sample Player B" meta="Sample Team · 1990s" position="C" state="selected" />
          <div className="flex flex-col gap-2">
            <PeakV2GameStatus label="Your turn" state="active" />
            <PeakV2GameStatus label="Waiting" state="idle" />
          </div>
        </div>
      </GallerySection>

      <PeakV2Rule />

      <GallerySection title="Data lane — YOU vs BOSS">
        <div className="flex flex-col gap-3">
          <PeakV2DataLane
            label="Statistical Impact"
            tone="si"
            leftLabel="You"
            leftValue="21.4"
            rightLabel="Boss"
            rightValue="18.9"
            winner="left"
          />
          <PeakV2DataLane
            label="Team Result"
            tone="team"
            leftLabel="You"
            leftValue="4.1"
            rightLabel="Boss"
            rightValue="6.7"
            winner="right"
          />
        </div>
      </GallerySection>

      <PeakV2Rule />

      <GallerySection title="Court-card grammar (Pass 3 preparation)">
        <PeakV2LiveHeader title="Sample roster" status={<PeakV2GameStatus label="Live" state="active" />} rule={false} />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PeakV2CourtSlot position="PG" player={{ name: "Sample Player A", meta: "Sample Team · 2010s" }} value="21.4" state="current" />
          <PeakV2CourtSlot position="SG" player={{ name: "Sample Player C", meta: "Sample Team · 2000s" }} value="18.2" state="staged" onMove={() => {}} />
          <PeakV2CourtSlot position="SF" state="empty" />
          <PeakV2CourtSlot position="C" player={{ name: "Sample Player D", meta: "Sample Team · 1990s" }} value="24.0" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
          <PeakV2CourtSlot position="Bench" bench player={{ name: "Sample Player E" }} />
          <PeakV2CourtSlot position="Bench" bench state="empty" />
        </div>
      </GallerySection>

      <PeakV2Rule />

      <GallerySection title="Modal">
        <PeakV2SecondaryAction onClick={() => setModalOpen(true)}>Open modal</PeakV2SecondaryAction>
        <PeakV2Modal open={modalOpen} onClose={() => setModalOpen(false)} label="Sample modal" size="sm">
          <PeakV2ResultHeadline as="h2" scale="line">
            Genuine independent state
          </PeakV2ResultHeadline>
          <p style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)", marginTop: 8 }}>
            The one V2 surface that earns a bordered, elevated container.
          </p>
          <div className="mt-4 flex justify-end">
            <PeakV2PrimaryAction onClick={() => setModalOpen(false)}>Close</PeakV2PrimaryAction>
          </div>
        </PeakV2Modal>
      </GallerySection>

      <PeakV2Rule />

      <GallerySection title="Cinematic stage">
        <PeakV2CinematicStage light={{ tone: "accent" }}>
          <PeakV2ResultHeadline as="h2" scale="moment">
            Sample Franchise · 2010s
          </PeakV2ResultHeadline>
          <PeakV2ResultHeadline as="p" scale="line" tone="accent" className="mt-2">
            Victory over The Wall
          </PeakV2ResultHeadline>
        </PeakV2CinematicStage>
      </GallerySection>
    </PeakV2Shell>
  );
}
