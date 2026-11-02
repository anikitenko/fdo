export interface ReleaseResult {
    repository: string;
    tag: string;
    publishedAt: string;
    releaseUrl: string;
    checkedAt: string;
}

export function readRepository(input: unknown): string {
    const repository = typeof input === 'string' ? input.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repository)
        || ['.', '..'].includes(repository.split('/')[1])) {
        throw new Error('Enter a public GitHub repository as owner/name, for example anikitenko/fdo.');
    }
    return repository;
}

export async function loadLatestRelease(input: unknown, options: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
} = {}): Promise<ReleaseResult> {
    const repository = readRepository(input);
    const [owner, repo] = repository.split('/');
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
        const response = await (options.fetcher ?? fetch)(url, {
            method: 'GET',
            headers: {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2026-03-10',
                'User-Agent': 'FDO-Workshop-Release-Monitor',
            },
            signal: controller.signal,
            redirect: 'error',
        });
        if (response.status === 404) throw new Error('No public latest release found. Check the repository name and whether it has a published release.');
        if (response.status === 403 || response.status === 429) throw new Error('GitHub denied or rate-limited this request. Wait before retrying; public requests are limited.');
        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. Try again later.`);
        const data = await response.json() as Record<string, unknown>;
        if (!data || typeof data.tag_name !== 'string' || !data.tag_name.trim()
            || typeof data.published_at !== 'string' || !Number.isFinite(Date.parse(data.published_at))
            || typeof data.html_url !== 'string') throw new Error('GitHub returned an unexpected release response.');
        const releaseUrl = new URL(data.html_url);
        if (releaseUrl.protocol !== 'https:' || releaseUrl.hostname !== 'github.com' || releaseUrl.username || releaseUrl.password) {
            throw new Error('GitHub returned an unexpected release link.');
        }
        return {repository, tag: data.tag_name, publishedAt: data.published_at,
            releaseUrl: releaseUrl.href, checkedAt: (options.now ?? (() => new Date()))().toISOString()};
    } catch (error) {
        if (controller.signal.aborted) throw new Error('The GitHub request timed out. Check your connection and retry.');
        if (error instanceof TypeError) throw new Error('GitHub could not be reached. Check your connection and the repository name, then retry.');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
