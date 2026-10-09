import DOMPurify from 'dompurify';

// The subtitle JSON response is not modeled by the generated SDK.
export interface SubtitleTrackEvent {
    StartPositionTicks?: number | null;
    EndPositionTicks?: number | null;
    Text?: string | null;
}

export function normalizeTrackEventText(text: string, useHtml: boolean) {
    const result = text
        .replace(/\\N/gi, '\n') // Correct newline characters
        .replace(/\r/gi, '') // Remove carriage return characters
        .replace(/{\\.*?}/gi, '') // Remove ass/ssa tags
        // Force LTR as the default direction
        .split('\n').map(val => `\u200E${val}`).join('\n');
    return useHtml ? result.replace(/\n/gi, '<br>') : result;
}

/** Render every active cue, including dialogue overlapping credits or signs. */
export function getSubtitleHtml(trackEvents: readonly SubtitleTrackEvent[], timeMs: number) {
    const ticks = timeMs * 10000;
    const activeEvents: { event: SubtitleTrackEvent; order: number }[] = [];

    for (const [order, trackEvent] of trackEvents.entries()) {
        const { StartPositionTicks, EndPositionTicks, Text } = trackEvent;
        // The end is exclusive so consecutive cues do not overlap at a boundary.
        if (StartPositionTicks != null && EndPositionTicks != null
            && StartPositionTicks <= ticks && ticks < EndPositionTicks && Text) {
            activeEvents.push({ event: trackEvent, order });
        }
    }

    // Keep earlier cues anchored while new cues stack above them. File order
    // alone is insufficient when a file lists credits separately from dialogue.
    activeEvents.sort((a, b) => (a.event.StartPositionTicks ?? 0) - (b.event.StartPositionTicks ?? 0) || a.order - b.order);
    return activeEvents.map(({ event }) => {
        // Sanitize each cue separately so an unclosed tag cannot style another cue.
        const text = DOMPurify.sanitize(normalizeTrackEventText(event.Text ?? '', true));
        return `<span class="subtitleCue">${text}</span>`;
    }).join('');
}
