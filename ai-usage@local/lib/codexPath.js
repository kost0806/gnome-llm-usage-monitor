// Ordered list of places to look for the `codex` binary when it is not on
// GNOME Shell's PATH (which usually lacks ~/.local/bin and nvm). Pure; the
// filesystem checks live in codex.js.

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

function versionParts(name) {
    const match = VERSION_PATTERN.exec(name);
    return match ? match.slice(1).map(Number) : null;
}

export function sortNodeVersionsDesc(names) {
    return names
        .map(name => ({name, parts: versionParts(name)}))
        .filter(entry => entry.parts !== null)
        .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2])
        .map(entry => entry.name);
}

export function codexCandidates(home, nvmVersionNames) {
    const nvm = sortNodeVersionsDesc(nvmVersionNames)
        .map(version => `${home}/.nvm/versions/node/${version}/bin/codex`);
    return [
        `${home}/.local/bin/codex`,
        `${home}/.npm-global/bin/codex`,
        ...nvm,
        '/usr/local/bin/codex',
    ];
}
