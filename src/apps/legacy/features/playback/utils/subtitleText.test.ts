import { describe, expect, it } from 'vitest';

import { getSubtitleHtml, normalizeTrackEventText, type SubtitleTrackEvent } from './subtitleText';

const cue = (startMs: number, endMs: number, text: string): SubtitleTrackEvent => ({
    StartPositionTicks: startMs * 10000,
    EndPositionTicks: endMs * 10000,
    Text: text
});

function render(events: SubtitleTrackEvent[], timeMs: number) {
    const container = globalThis.document.createElement('div');
    container.innerHTML = getSubtitleHtml(events, timeMs);
    return Array.from(container.children).map(element => element.innerHTML).join('<br>');
}

describe('getSubtitleHtml', () => {
    it('groups cues separately without reversing their internal lines', () => {
        const container = globalThis.document.createElement('div');
        container.innerHTML = getSubtitleHtml([cue(0, 2000, 'First\nSecond'), cue(1000, 3000, 'Third')], 1500);
        const groups = container.querySelectorAll(':scope > .subtitleCue');
        expect(groups).toHaveLength(2);
        expect(groups[0].innerHTML).toBe('\u200EFirst<br>\u200ESecond');
        expect(groups[1].textContent).toBe('\u200EThird');
    });

    it('repairs unclosed markup before composing other cues', () => {
        expect(render([cue(0, 2000, '<i>Credit'), cue(0, 2000, 'Dialogue')], 1000))
            .toBe('\u200E<i>Credit</i><br>\u200EDialogue');
    });

    it('shows dialogue overlapping translation credits in Simpsons S37E15', () => {
        const events = [
            cue(11510, 16510, '翻译       sundowwn  夏天  Carolingo'),
            cue(13080, 16230, '下面有请一直纠缠我们促成了这东西的小姑娘')
        ];

        expect(render(events, 14000)).toBe(
            '\u200E翻译       sundowwn  夏天  Carolingo<br>\u200E下面有请一直纠缠我们促成了这东西的小姑娘'
        );
        expect(render(events, 16300)).toBe('\u200E翻译       sundowwn  夏天  Carolingo');
        expect(render(events, 17000)).toBe('');
    });

    it('keeps a persistent sign while dialogue changes and seeking goes backwards', () => {
        // Subtitle files can list credits or signs before earlier dialogue.
        const events = [
            cue(2000, 8000, 'Sign'),
            cue(1000, 4000, 'First dialogue'),
            cue(4000, 6000, 'Second dialogue')
        ];

        expect(render(events, 5000)).toBe('\u200ESign<br>\u200ESecond dialogue');
        expect(render(events, 3000)).toBe('\u200EFirst dialogue<br>\u200ESign');
        expect(render(events, 4000)).toBe('\u200ESign<br>\u200ESecond dialogue');
        expect(render(events, 8000)).toBe('');
    });

    it('preserves multiline text and supported markup in overlapping cues', () => {
        const events = [
            cue(0, 2000, '<i>First line</i>\r\nSecond line'),
            cue(1000, 3000, 'Third line\\NFourth line')
        ];

        expect(render(events, 1500)).toBe(
            '\u200E<i>First line</i><br>\u200ESecond line<br>\u200EThird line<br>\u200EFourth line'
        );
    });

    it('sanitizes every cue without discarding other active dialogue', () => {
        const events = [
            cue(0, 2000, '<script>alert(1)</script><b onclick="alert(1)">Credit</b>'),
            cue(0, 2000, '<img src="x" onerror="alert(1)">Dialogue')
        ];

        expect(render(events, 1000)).toBe(
            '\u200E<b>Credit</b><br>\u200E<img src="x">Dialogue'
        );
    });

    it('ignores empty or incomplete cues without hiding valid cues', () => {
        expect(render([
            cue(0, 2000, ''),
            { Text: 'Missing timestamps' },
            { StartPositionTicks: 0, Text: 'Missing end' },
            cue(0, 2000, 'Dialogue')
        ], 1000)).toBe('\u200EDialogue');
        expect(render([], 1000)).toBe('');
    });

    it('calculates each track independently without retaining expired cues', () => {
        const primary = [cue(0, 2000, 'Credit'), cue(1000, 3000, 'Chinese')];
        const secondary = [cue(1000, 3000, 'English')];

        expect(render(primary, 1500)).toBe('\u200ECredit<br>\u200EChinese');
        expect(render(secondary, 1500)).toBe('\u200EEnglish');
        expect(render(primary, 2500)).toBe('\u200EChinese');
        expect(render(primary, 500)).toBe('\u200ECredit');
    });

    it('uses adjusted cue timestamps and playback time after a transcoding seek', () => {
        const events = [cue(61000, 64000, 'Credit'), cue(62000, 65000, 'Dialogue')];
        // The player applies the subtitle offset to the events before rendering.
        for (const event of events) {
            event.StartPositionTicks = (event.StartPositionTicks ?? 0) - 10000000;
            event.EndPositionTicks = (event.EndPositionTicks ?? 0) - 10000000;
        }

        // Two seconds into a stream starting at 60 seconds.
        expect(render(events, 2000 + 60000)).toBe('\u200ECredit<br>\u200EDialogue');
        expect(events[0].StartPositionTicks).toBe(600000000);
    });
});

describe('normalizeTrackEventText', () => {
    it('retains native text normalization without generating HTML', () => {
        expect(normalizeTrackEventText('{\\an8}First\\NSecond\r\nThird', false))
            .toBe('\u200EFirst\n\u200ESecond\n\u200EThird');
    });
});
