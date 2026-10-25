const settings = require('./settings');
const { generateLocalResponse } = require('./ollamaClient');
const { generateOpenAiDiagramResponse } = require('./openaiDiagramClient');

async function generateDiagramResponse(options) {
  settings.assertDiagramProvider();
  if (settings.usesOpenAiDiagrams()) {
    return generateOpenAiDiagramResponse(options);
  }
  return generateLocalResponse(options);
}

module.exports = { generateDiagramResponse };
