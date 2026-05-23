const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, 'frontend', 'index.html');
const stylesCssPath = path.join(__dirname, 'frontend', 'styles.css');

let html = fs.readFileSync(indexHtmlPath, 'utf8');
let css = fs.readFileSync(stylesCssPath, 'utf8');

// 1. Update Tailwind config
html = html.replace(
    /tailwind\.config = {/,
    "tailwind.config = {\n            darkMode: 'class',"
);

// 2. Refactor colors in HTML
const replacements = [
    [/bg-dark/g, 'bg-gray-50 dark:bg-dark'],
    [/text-zinc-400/g, 'text-zinc-600 dark:text-zinc-400'],
    [/\btext-white\b/g, 'text-zinc-900 dark:text-white'],
    [/bg-\[\#0a0a0a\]/g, 'bg-white dark:bg-[#0a0a0a]'],
    [/bg-\[\#111\]/g, 'bg-white dark:bg-[#111]'],
    [/border-white\/\[0\.06\]/g, 'border-zinc-200 dark:border-white/[0.06]'],
    [/border-white\/\[0\.08\]/g, 'border-zinc-200 dark:border-white/[0.08]'],
    [/bg-white\/\[0\.04\]/g, 'bg-black/[0.04] dark:bg-white/[0.04]'],
    [/bg-white\/\[0\.06\]/g, 'bg-black/[0.06] dark:bg-white/[0.06]'],
    [/bg-white\/\[0\.1\]/g, 'bg-black/[0.1] dark:bg-white/[0.1]'],
    [/bg-white\/\[0\.05\]/g, 'bg-black/[0.05] dark:bg-white/[0.05]'],
    [/border-white\/\[0\.1\]/g, 'border-zinc-300 dark:border-white/[0.1]'],
    [/bg-black\/80/g, 'bg-zinc-200/80 dark:bg-black/80'],
    [/\bbg-black\b/g, 'bg-gray-100 dark:bg-black'],
    [/text-zinc-300/g, 'text-zinc-700 dark:text-zinc-300'],
    [/hover:bg-white\/\[0\.08\]/g, 'hover:bg-black/[0.08] dark:hover:bg-white/[0.08]'],
    [/hover:text-white/g, 'hover:text-black dark:hover:text-white'],
];

for (const [regex, replacement] of replacements) {
    html = html.replace(regex, replacement);
}

// 3. Add Theme Toggle Button to Home Nav
const themeToggleSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 hidden dark:block text-zinc-400 hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 block dark:hidden text-zinc-500 hover:text-black transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>`;

const homeNavButton = `
                    <button onclick="toggleTheme()" class="p-2 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-zinc-200 dark:border-white/[0.08]">
                        ${themeToggleSvg}
                    </button>
                    <button id="create-public-room-btn"`;

html = html.replace('<button id="create-public-room-btn"', homeNavButton);

// 4. Add Theme Toggle Button to Editor Header
const editorHeaderButton = `
                    <button onclick="toggleTheme()" class="p-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-zinc-200 dark:border-white/[0.08] mr-1 flex items-center justify-center h-full">
                        ${themeToggleSvg}
                    </button>
                    <div id="participants-list"`;

html = html.replace('<div id="participants-list"', editorHeaderButton);

// 5. Mobile Layout Improvements
html = html.replace(
    'id="content-wrapper" class="flex-grow flex flex-row gap-0 p-2 overflow-hidden"',
    'id="content-wrapper" class="flex-grow flex flex-col md:flex-row gap-2 md:gap-0 p-2 overflow-hidden"'
);

html = html.replace(
    'id="resizer" class="resizer"',
    'id="resizer" class="resizer hidden md:block"'
);

// Group editor buttons in a scrollable container for mobile
html = html.replace(
    '<div class="flex items-center gap-2">',
    '<div class="flex items-center gap-2 overflow-x-auto whitespace-nowrap scrollbar-hide flex-shrink max-w-[60vw] md:max-w-none">'
);

// Also remove style="flex-basis: 50%;" and use flex-1 on editor and output panel
html = html.replace(/style="flex-basis: 50%;"/g, 'class="flex-1 w-full md:w-auto h-1/2 md:h-auto min-h-0"');

// Fix the extra class attribute added by the previous replace
html = html.replace(
    'id="editor-panel" class="flex flex-col gap-1" class="flex-1 w-full md:w-auto h-1/2 md:h-auto min-h-0"',
    'id="editor-panel" class="flex flex-col gap-1 flex-1 w-full md:w-auto h-1/2 md:h-auto min-h-0"'
);

html = html.replace(
    'id="output-panel" class="relative bg-white dark:bg-white rounded-lg overflow-hidden" class="flex-1 w-full md:w-auto h-1/2 md:h-auto min-h-0"',
    'id="output-panel" class="relative bg-white rounded-lg overflow-hidden flex-1 w-full md:w-auto h-1/2 md:h-auto min-h-0"'
);
html = html.replace( // in case it missed because of dark:bg-white replacement earlier
    'id="output-panel" class="relative bg-white rounded-lg overflow-hidden" class="flex-1 w-full md:w-auto h-1/2 md:h-auto min-h-0"',
    'id="output-panel" class="relative bg-white rounded-lg overflow-hidden flex-1 w-full md:w-auto h-1/2 md:h-auto min-h-0"'
);


// Fix duplicate classes resulting from replace overlap
html = html.replace(/class="([^"]*)"\s+class="([^"]*)"/g, 'class="$1 $2"');


// 6. Fix CSS file for light mode support
// Popups
css = css.replace(
    /background: #111;/g,
    'background: #fff;\n            @apply dark:bg-[#111];'
);
css = css.replace(
    /border: 1px solid rgba\(255, 255, 255, 0\.08\);/g,
    'border: 1px solid #e4e4e7;\n            @apply dark:border-white/[0.08];'
);
css = css.replace(
    /background: rgba\(255, 255, 255, 0\.03\);/g,
    'background: #f4f4f5;\n            @apply dark:bg-white/[0.03];'
);
css = css.replace(
    /border-left: 2px solid rgba\(255, 255, 255, 0\.12\);/g,
    'border-left: 2px solid #d4d4d8;\n            @apply dark:border-white/[0.12];'
);
css = css.replace(
    /color: #a1a1aa;/g,
    'color: #3f3f46;\n            @apply dark:text-[#a1a1aa];'
);
css = css.replace(
    /background: #0a0a0a;/g,
    'background: #fafafa;\n            @apply dark:bg-[#0a0a0a];'
);
css = css.replace(
    /color: #d4d4d8;/g,
    'color: #27272a;\n            @apply dark:text-[#d4d4d8];'
);
css = css.replace(
    /border: 1px solid rgba\(255, 255, 255, 0\.1\);/g,
    'border: 1px solid #e4e4e7;\n            @apply dark:border-white/[0.1];'
);
// Home Nav
css = css.replace(
    /background: rgba\(0, 0, 0, 0\.8\);/g,
    'background: rgba(255, 255, 255, 0.8);\n            @apply dark:bg-black/80;'
);
// Header Glass
css = css.replace(
    /background: #000;/g,
    'background: #f4f4f5;\n            @apply dark:bg-[#000];'
);

fs.writeFileSync(indexHtmlPath, html);
fs.writeFileSync(stylesCssPath, css);
console.log('Refactoring complete!');
