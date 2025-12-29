import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
    const changelogPath = resolve('CHANGELOG.md');
    const content = readFileSync(changelogPath, 'utf-8');

    // Regex to find the first version section
    // Matches "## [1.2.0] - DATE" until the next "## [" or End of String
    const versionRegex = /^## \[\d+\.\d+\.\d+\].*$(?:\r?\n|\r)([\s\S]*?)(?=^## \[|$)/m;

    const match = content.match(versionRegex);

    if (match && match[1]) {
        // Trim whitespace
        console.log(match[1].trim());
    } else {
        console.error('Could not find latest version in CHANGELOG.md');
        process.exit(1);
    }
} catch (error) {
    console.error('Error reading CHANGELOG.md:', error);
    process.exit(1);
}
