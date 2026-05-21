const { buildTooltipHTML } = require('./src/lib/ui/tooltipBuilder.js');

// Mock node with potentially dangerous content
const node = {
  name: '<script>alert("xss")</script>',
  id: 'test-id',
  type: 'test',
  weight: 2.5,
  confidence: 0.75,
  community: '<script>bad</script>',
  communityColor: '#ff0000',
  citationCount: 42
};

const html = buildTooltipHTML(node);
console.log('Generated HTML:');
console.log(html);

// Check that dangerous content is escaped
if (html.includes('<script>')) {
  console.error('ERROR: HTML contains unescaped <script>');
  process.exit(1);
} else {
  console.log('SUCCESS: <script> tags are escaped');
}

// Check that we have the expected classes and structure
if (html.includes('tt-title') && html.includes('tt-row') && html.includes('tt-badge')) {
  console.log('SUCCESS: Expected tooltip classes present');
} else {
  console.error('ERROR: Missing expected tooltip classes');
  process.exit(1);
}

console.log('All tests passed');
