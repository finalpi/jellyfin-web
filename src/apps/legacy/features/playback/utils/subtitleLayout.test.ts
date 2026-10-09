import { describe, expect, it } from 'vitest';

import { getTextSubtitleLayout } from './subtitleLayout';

describe('getTextSubtitleLayout', () => {
    it('scales normal text to 30px at 720p and 45px at 1080p', () => {
        const size = Number.parseFloat(getTextSubtitleLayout({})['font-size']);
        expect(size * 720 / 100).toBeCloseTo(30);
        expect(size * 1080 / 100).toBeCloseTo(45);
    });

    it('anchors the existing default position at a 34px margin at 720p', () => {
        const margin = getTextSubtitleLayout({ verticalPosition: -3 })['margin-bottom'];
        expect(margin).toContain('0em');
        expect(Number.parseFloat(margin.split('calc(')[1]) * 720 / 100).toBeCloseTo(34);
        expect(getTextSubtitleLayout({ verticalPosition: -4 })['margin-bottom']).toContain('1.35em');
    });

    it('keeps top-aligned captions and invalid positions usable', () => {
        expect(getTextSubtitleLayout({ verticalPosition: 2 })['margin-top']).toBe('2.7em');
        expect(getTextSubtitleLayout({ verticalPosition: 2 })['margin-bottom']).toBe('');
        expect(getTextSubtitleLayout({ verticalPosition: 'invalid' })['margin-bottom']).not.toContain('NaN');
    });

    it('retains the user-selected size, font and outline modes', () => {
        const small = getTextSubtitleLayout({ textSize: 'small' });
        const large = getTextSubtitleLayout({ textSize: 'large', font: 'console', dropShadow: 'none' });
        expect(Number.parseFloat(small['font-size'])).toBeLessThan(Number.parseFloat(large['font-size']));
        expect(large['font-family']).toBeUndefined();
        expect(large['text-shadow']).toBeUndefined();
    });
});
