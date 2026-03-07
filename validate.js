const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const lines = html.split('\n');

// Find lines 1306 to 1922 (the main script block)
console.log('=== Checking main script (lines 1306-1922) for issues ===\n');

// Check EVERY line for </script> (not escaped)
for (let i = 1305; i < 1922; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for </script> that is NOT escaped (\/)
    if (line.includes('</script>')) {
        console.log('Line ' + lineNum + ' has </script>: ' + line.trim().substring(0, 100));
    }
    if (line.includes('<\\/script>')) {
        console.log('Line ' + lineNum + ' has <\\/script> (escaped - OK): ' + line.trim().substring(0, 100));
    }

    // Also check for unescaped <script> tags
    if (line.includes('<script>') && lineNum !== 1306) {
        const escaped = line.includes('<\\/') || line.includes('\\n') || line.includes('`');
        console.log('Line ' + lineNum + ' has <script>' + (escaped ? ' (in template literal)' : ' *** PLAIN ***') + ': ' + line.trim().substring(0, 100));
    }
}

console.log('\n=== Check if window.onerror is actually reachable ===');
// window.onerror is at line 1308. Check if it's really there.
console.log('Line 1308: ' + (lines[1307] || 'undefined').trim());
console.log('Line 1309: ' + (lines[1308] || 'undefined').trim());
console.log('Line 1310: ' + (lines[1309] || 'undefined').trim());
console.log('Line 1311: ' + (lines[1310] || 'undefined').trim());
