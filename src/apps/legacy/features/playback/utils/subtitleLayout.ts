interface SubtitleAppearance {
    textSize?: string;
    verticalPosition?: string | number;
    dropShadow?: string;
    font?: string;
}

/** Viewport-scaled styling for the custom text subtitle renderer. */
export function getTextSubtitleLayout(settings: SubtitleAppearance): Record<string, string> {
    const sizes: Record<string, number> = {
        smaller: 0.8, small: 1, medium: 1.36, large: 1.72, larger: 2, extralarge: 2.2
    };
    const scale = (sizes[settings.textSize ?? 'medium'] ?? 1.36) / 1.36;
    const position = Number(settings.verticalPosition ?? -3);
    const bottomAligned = !Number.isFinite(position) || position < 0;
    const lineOffset = Number.isFinite(position) ? (-position - 3) * 1.35 : 0;
    const styles: Record<string, string> = {
        // 30 CSS pixels at 720p match the glyph size of the Windows libass reference.
        'font-size': `${30 / 720 * 100 * scale}vh`,
        'line-height': '1.35',
        'margin-top': bottomAligned ? '' : `${position * 1.35}em`,
        // Preserve the position slider's line steps, anchored at mpv's 34/720 margin.
        'margin-bottom': bottomAligned ?
            `max(0px, calc(${34 / 720 * 100}vh + ${lineOffset}em))` :
            ''
    };
    if (!settings.font || settings.font === 'default') {
        styles['font-family'] = 'Arial,"Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif';
    }
    if (!settings.dropShadow || settings.dropShadow === 'dropshadow') {
        styles['text-shadow'] = [
            '-0.055em -0.055em', '0 -0.055em', '0.055em -0.055em',
            '-0.055em 0', '0.055em 0',
            '-0.055em 0.055em', '0 0.055em', '0.055em 0.055em'
        ].map(offset => `${offset} 0 #000`).join(',');
    }
    return styles;
}
