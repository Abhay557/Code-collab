
const cleanCode = (code) => {
    if (!code) return null;

    // Strip output wrapper tags
    code = code.replace(/<body[^>]*>/i, '').replace(/<\/body>/i, '');
    code = code.replace(/<html[^>]*>/i, '').replace(/<\/html>/i, '');
    code = code.replace(/<head[^>]*>/i, '').replace(/<\/head>/i, '');

    // Strip chatty command lines at start
    const lines = code.split('\n');
    let startIndex = 0;
    while (startIndex < lines.length) {
        const line = lines[startIndex].trim();
        if (!line) {
            startIndex++;
            continue;
        }
        // Skip lines starting with ( or Note: or Here is...
        console.log(`Checking line: "${line}"`);
        console.log(`Starts with '(': ${line.startsWith('(')}`);

        if (line.startsWith('(') || line.startsWith('Note:') || line.match(/^Here is/i) || line.match(/^Sure,/i)) {
            startIndex++;
        } else {
            break;
        }
    }
    return lines.slice(startIndex).join('\n').trim();
};

const input1 = `(body content only, no html/head/body tags)`;
const input2 = `(body content only, no html/head/body tags)\n<h1>Hello</h1>`;
const input3 = `\ufeff(body content only, no html/head/body tags)`; // with BOM

console.log('--- TEST 1 ---');
console.log(`Result: "${cleanCode(input1)}"`);

console.log('--- TEST 2 ---');
console.log(`Result: "${cleanCode(input2)}"`);

console.log('--- TEST 3 ---');
console.log(`Result: "${cleanCode(input3)}"`);
