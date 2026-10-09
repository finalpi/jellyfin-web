import type { Api } from '@jellyfin/sdk';
import type { FontFile } from '@jellyfin/sdk/lib/generated-client/models/font-file';
import { getSubtitleApi } from '@jellyfin/sdk/lib/utils/api/subtitle-api';

export const SERVER_FONT_PREFIX = 'server:';
const SYSTEM_FONTS = 'Arial,"Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif';

export function usesServerSubtitleFont(selection?: string) {
    return !selection || selection === 'default' || selection.startsWith(SERVER_FONT_PREFIX);
}

export function getSubtitleFontFamily(selection?: string) {
    return usesServerSubtitleFont(selection) ? `var(--jellyfin-subtitle-font, ${SYSTEM_FONTS})` : SYSTEM_FONTS;
}

interface FontSource {
    list: () => Promise<FontFile[]>;
    download: (name: string) => Promise<ArrayBuffer>;
}

interface FontEnvironment {
    fonts: FontFaceSet;
    create: (family: string, data: ArrayBuffer) => FontFace;
}

let nextFamilyId = 0;

/** Fetch metadata once per minute; download only the chosen font per document. */
export class SubtitleFontLoader {
    private listing?: Promise<FontFile[]>;
    private expiresAt = 0;
    private readonly loaded = new WeakMap<FontFaceSet, Map<string, Promise<string | undefined>>>();

    constructor(public source: FontSource) {}

    list(): Promise<FontFile[]> {
        if (!this.listing || Date.now() >= this.expiresAt) {
            this.expiresAt = Date.now() + 60000;
            this.listing = this.source.list().then(files => files.filter(file => {
                const name = file.Name ?? '';
                return !/[\\/]/.test(name) && /\.(woff2?|ttf|otf)$/i.test(name);
            }).sort((a, b) => (a.Name ?? '').localeCompare(b.Name ?? ''))).catch(() => {
                this.expiresAt = 0;
                return [];
            });
        }
        return this.listing;
    }

    async load(selection: string | undefined, environment: FontEnvironment): Promise<string | undefined> {
        if (!usesServerSubtitleFont(selection)) return undefined;
        const files = await this.list();
        const file = selection?.startsWith(SERVER_FONT_PREFIX) ?
            files.find(font => font.Name === selection.slice(SERVER_FONT_PREFIX.length)) : files[0];
        if (!file?.Name) return undefined;
        const cache = this.loaded.get(environment.fonts) ?? new Map<string, Promise<string | undefined>>();
        this.loaded.set(environment.fonts, cache);
        const key = `${file.Name}|${file.Size}|${file.DateModified}`;
        let pending = cache.get(key);
        if (!pending) {
            const family = `JellyfinSubtitleFont${++nextFamilyId}`;
            pending = this.source.download(file.Name).then(async data => {
                const face = environment.create(family, data);
                await face.load();
                environment.fonts.add(face);
                return family;
            }).catch(() => {
                cache.delete(key);
                return undefined;
            });
            cache.set(key, pending);
        }
        return pending;
    }
}

const loaders = new Map<string, SubtitleFontLoader>();
const requests = new WeakMap<HTMLElement, object>();

export function getServerSubtitleFonts(api: Api) {
    const subtitleApi = getSubtitleApi(api);
    const source: FontSource = {
        list: async () => (await subtitleApi.getFallbackFontList({ timeout: 5000 })).data,
        download: async name => {
            const response = await subtitleApi.getFallbackFont({ name }, { responseType: 'arraybuffer', timeout: 10000 });
            // The generated SDK types binary responses as File regardless of responseType.
            return response.data as unknown as ArrayBuffer;
        }
    };
    let loader = loaders.get(api.basePath);
    if (!loader) {
        loader = new SubtitleFontLoader(source);
        loaders.set(api.basePath, loader);
    } else {
        loader.source = source;
    }
    return loader;
}

/** Apply a loaded font only if this element still belongs to the same request. */
export async function applyServerSubtitleFont(element: HTMLElement, api: Api, selection?: string) {
    const request = {};
    requests.set(element, request);
    element.style.removeProperty('--jellyfin-subtitle-font');
    const fonts = element.ownerDocument.fonts;
    const FontConstructor = element.ownerDocument.defaultView?.FontFace;
    if (!fonts || !FontConstructor || !usesServerSubtitleFont(selection)) return;
    const family = await getServerSubtitleFonts(api).load(selection, {
        fonts,
        create: (name, data) => new FontConstructor(name, data)
    });
    if (family && requests.get(element) === request && element.isConnected) {
        element.style.setProperty('--jellyfin-subtitle-font', `"${family}"`);
        return family;
    }
    return undefined;
}
