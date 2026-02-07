const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');

try {
    console.log(`Checking for hotfix in ${filePath}...`);
    
    if (!fs.existsSync(filePath)) {
        console.error('Client.js not found! Cannot apply hotfix.');
        process.exit(1); // Fail the build
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Pattern to look for: await response.text()
    // We want to replace it with: await response.text().catch(() => "")
    
    // Check if already patched
    if (content.includes('await response.text().catch')) {
        console.log('Hotfix already applied. Skipping.');
    } else if (content.includes('await response.text()')) {
        console.log('applying hotfix...');
        const newContent = content.replace(
            /await response\.text\(\)/g, 
            'await response.text().catch(() => "")'
        );
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log('Hotfix applied successfully!');
    } else {
        console.warn('Could not find "await response.text()" in Client.js. The library version might be different than expected.');
        // Consider failing here too if we are sure it SHOULD be there
    }

} catch (err) {
    console.error('Error applying hotfix:', err);
    process.exit(1);
}
