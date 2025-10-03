const fs = require('fs');

// Read the admin.html file
let content = fs.readFileSync('admin.html', 'utf8');

console.log(`Original size: ${content.length} characters`);

// Simple cleanup - only remove extra spaces and empty lines
let cleaned = content
    // Remove multiple consecutive empty lines (keep max 2)
    .replace(/\n\s*\n\s*\n\s*\n+/g, '\n\n')
    // Remove trailing whitespace from lines
    .replace(/[ \t]+$/gm, '')
    // Remove lines that are only whitespace
    .replace(/^\s*\n/gm, '\n')
    // Remove excessive spaces (more than 2 spaces)
    .replace(/[ \t]{3,}/g, '  ')
    // Final cleanup
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Write the cleaned content back
fs.writeFileSync('admin.html', cleaned);

console.log(`Final size: ${cleaned.length} characters`);
console.log(`Reduction: ${((content.length - cleaned.length) / content.length * 100).toFixed(1)}%`);
console.log('✅ Simple cleanup completed!');
