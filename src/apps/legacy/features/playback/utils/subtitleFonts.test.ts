import type { Api } from '@jellyfin/sdk';
import { getSubtitleApi } from '@jellyfin/sdk/lib/utils/api/subtitle-api';
import { describe, expect, it, vi } from 'vitest';

import { applyServerSubtitleFont, getSubtitleFontFamily, SubtitleFontLoader } from './subtitleFonts';

vi.mock('@jellyfin/sdk/lib/utils/api/subtitle-api', () => ({ getSubtitleApi: vi.fn() }));

function fixture() {
    const list = vi.fn().mockResolvedValue([{ Name: 'msyh.woff2', Size: 100, DateModified: '2026-10-09' }]);
    const download = vi.fn().mockResolvedValue(new ArrayBuffer(4));
    const add = vi.fn();
    const face = { family: 'test', load: vi.fn().mockResolvedValue(undefined) } as unknown as FontFace;
    const create = vi.fn().mockReturnValue(face);
    return { list, download, add, face, create, loader: new SubtitleFontLoader({ list, download }),
        environment: { fonts: { add } as unknown as FontFaceSet, create } };
}

describe('SubtitleFontLoader', () => {
    it('loads the default server font and registers it only after decoding', async () => {
        const f = fixture();
        const family = await f.loader.load('', f.environment);
        expect(f.download).toHaveBeenCalledWith('msyh.woff2');
        expect(f.create).toHaveBeenCalledWith(family, expect.any(ArrayBuffer));
        expect(f.face.load).toHaveBeenCalledOnce();
        expect(f.add).toHaveBeenCalledWith(f.face);
    });

    it('shares concurrent requests between primary and secondary subtitle elements', async () => {
        const f = fixture();
        const result = await Promise.all([f.loader.load('', f.environment), f.loader.load('server:msyh.woff2', f.environment)]);
        expect(result[0]).toBe(result[1]);
        expect(f.list).toHaveBeenCalledOnce();
        expect(f.download).toHaveBeenCalledOnce();
        expect(f.add).toHaveBeenCalledOnce();
    });

    it('downloads only the selected font, never the entire directory', async () => {
        const f = fixture();
        f.list.mockResolvedValue([{ Name: 'a.ttf' }, { Name: 'msyh.woff2' }, { Name: 'z.otf' }]);
        await f.loader.load('server:msyh.woff2', f.environment);
        expect(f.download).toHaveBeenCalledExactlyOnceWith('msyh.woff2');
    });

    it('does not contact the server for explicitly selected local fonts', async () => {
        const f = fixture();
        expect(await f.loader.load('system', f.environment)).toBeUndefined();
        expect(await f.loader.load('console', f.environment)).toBeUndefined();
        expect(f.list).not.toHaveBeenCalled();
        expect(f.download).not.toHaveBeenCalled();
    });

    it('falls back without registering a font when the directory or selected file is unavailable', async () => {
        const f = fixture();
        f.list.mockRejectedValue(new Error('Unauthorized'));
        expect(await f.loader.load('', f.environment)).toBeUndefined();
        f.list.mockResolvedValue([{ Name: 'msyh.woff2' }]);
        expect(await f.loader.load('server:deleted.ttf', f.environment)).toBeUndefined();
        expect(f.download).not.toHaveBeenCalled();
        expect(f.add).not.toHaveBeenCalled();
    });

    it('retries failed downloads and leaves fallback text visible', async () => {
        const f = fixture();
        f.download.mockRejectedValueOnce(new Error('Network failure'));
        expect(await f.loader.load('', f.environment)).toBeUndefined();
        expect(f.add).not.toHaveBeenCalled();
        expect(await f.loader.load('', f.environment)).toMatch(/^JellyfinSubtitleFont/);
        expect(f.download).toHaveBeenCalledTimes(2);
    });

    it('rejects invalid font files while retaining supported formats', async () => {
        const f = fixture();
        f.list.mockResolvedValue([{ Name: '../private.ttf' }, { Name: 'readme.txt' }, { Name: 'font.OTF' }, { Name: 'msyh.woff2' }]);
        expect((await f.loader.list()).map(font => font.Name)).toEqual(['font.OTF', 'msyh.woff2']);
    });

    it('falls back when a downloaded file is not a valid browser font', async () => {
        const f = fixture();
        vi.mocked(f.face.load).mockRejectedValue(new Error('Invalid font'));
        expect(await f.loader.load('', f.environment)).toBeUndefined();
        expect(f.add).not.toHaveBeenCalled();
    });

    it('registers the font in each document instead of reusing another document font set', async () => {
        const f = fixture();
        const otherAdd = vi.fn();
        const first = await f.loader.load('', f.environment);
        const second = await f.loader.load('', { fonts: { add: otherAdd } as unknown as FontFaceSet, create: f.create });
        expect(second).not.toBe(first);
        expect(f.add).toHaveBeenCalledOnce();
        expect(otherAdd).toHaveBeenCalledOnce();
    });
});

describe('getSubtitleFontFamily', () => {
    it('uses a local fallback for default and saved server selections', () => {
        expect(getSubtitleFontFamily('')).toContain('var(--jellyfin-subtitle-font, Arial');
        expect(getSubtitleFontFamily('server:msyh.woff2')).toContain('var(--jellyfin-subtitle-font');
        expect(getSubtitleFontFamily('system')).not.toContain('var(');
    });
});

describe('applyServerSubtitleFont', () => {
    function elementFixture(basePath: string) {
        const f = fixture();
        const getFallbackFontList = vi.fn().mockResolvedValue({ data: [{ Name: 'msyh.woff2' }] });
        const getFallbackFont = vi.fn().mockResolvedValue({ data: new ArrayBuffer(4) });
        vi.mocked(getSubtitleApi).mockReturnValue({ getFallbackFontList, getFallbackFont } as unknown as ReturnType<typeof getSubtitleApi>);
        const setProperty = vi.fn();
        const element = {
            ownerDocument: { fonts: f.environment.fonts, defaultView: { FontFace: f.create } },
            isConnected: true,
            style: { removeProperty: vi.fn(), setProperty }
        } as unknown as HTMLElement;
        return { ...f, element, setProperty, getFallbackFont, api: { basePath } as Api };
    }

    it('applies a downloaded font using the authenticated SDK binary endpoint', async () => {
        const f = elementFixture('https://font-test/apply');
        const family = await applyServerSubtitleFont(f.element, f.api, 'server:msyh.woff2');
        expect(f.getFallbackFont).toHaveBeenCalledWith({ name: 'msyh.woff2' }, { responseType: 'arraybuffer', timeout: 10000 });
        expect(f.setProperty).toHaveBeenCalledWith('--jellyfin-subtitle-font', `"${family}"`);
    });

    it('does not overwrite a newer local-font choice when an old download completes', async () => {
        const f = elementFixture('https://font-test/race');
        let finish: ((font: FontFace) => void) | undefined;
        vi.mocked(f.face.load).mockImplementation(() => new Promise(resolve => {
            finish = resolve;
        }));
        const pending = applyServerSubtitleFont(f.element, f.api, '');
        await vi.waitFor(() => expect(f.face.load).toHaveBeenCalled());
        await applyServerSubtitleFont(f.element, f.api, 'system');
        finish?.(f.face);
        await pending;
        expect(f.setProperty).not.toHaveBeenCalled();
    });

    it('keeps detached subtitle elements untouched', async () => {
        const f = elementFixture('https://font-test/detached');
        Object.defineProperty(f.element, 'isConnected', { value: false });
        expect(await applyServerSubtitleFont(f.element, f.api, '')).toBeUndefined();
        expect(f.setProperty).not.toHaveBeenCalled();
    });
});
