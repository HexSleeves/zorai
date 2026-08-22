const { createLspRuntime } = require('./main/lsp-runtime.cjs');

async function main() {
    const runtime = createLspRuntime();
    const events = [];
    const webContents = {
        isDestroyed: () => false,
        send: (channel, payload) => events.push({ channel, payload }),
    };
    const root = process.argv[2];
    const file = process.argv[3] || 'crates/zorai-protocol/src/messages/client.rs';
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    const opened = await runtime.open(webContents, root, file, 'rust', content, 1);
    if (!opened.available) throw new Error(opened.reason || 'rust-analyzer unavailable');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const hover = await runtime.request(webContents, root, file, 'rust', 'hover', { line: 0, character: 0 });
    await runtime.unsubscribe(webContents, root, 'rust');
    await runtime.stopAll();
    console.log(JSON.stringify({ opened: opened.available, server: opened.server, diagnosticsEvents: events.length, hoverAvailable: hover.available }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
