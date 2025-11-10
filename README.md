# FDO (FlexDevOps)

FDO (Flex DevOps) is a modular, plugin-driven DevOps platform built with ElectronJS and React. It empowers developers and SREs to extend core functionality using secure, versioned plugins, offering tools for automation, deployment, monitoring, and workflow customization — all from a unified desktop environment.

## Features

- **Plugin System**: Modular architecture with secure, versioned plugins
- **Code Editor**: Built-in Monaco-based editor for plugin development
- **AI Coding Agent**: Intelligent coding assistant integrated into the editor (NEW!)
- **Live UI**: Real-time plugin UI preview
- **Certificate Management**: Built-in PKI for plugin signing and trust
- **SDK**: Comprehensive SDK for building plugins with rich UI capabilities

## AI Coding Agent

The AI Coding Agent provides intelligent coding assistance directly in the FDO editor:

- **Generate Code**: Create new code from natural language descriptions
- **Edit Code**: Modify selected code with AI-powered suggestions
- **Explain Code**: Get detailed explanations of code functionality
- **Fix Code**: Debug and repair code with AI assistance

The AI agent is **FDO SDK-aware** and understands plugin architecture, helping you build better plugins faster.

[Learn more about the AI Coding Agent](docs/AI_CODING_AGENT.md)

## Quick Start

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build for production
npm run build

# Package application
npm run package
```

## Plugin Development

FDO uses the [@anikitenko/fdo-sdk](https://github.com/anikitenko/fdo-sdk) for plugin development.

Example plugin:

```typescript
import { FDO_SDK, FDOInterface, PluginMetadata } from "@anikitenko/fdo-sdk";

export default class MyPlugin extends FDO_SDK implements FDOInterface {
    private readonly _metadata: PluginMetadata = {
        name: "My Plugin",
        version: "1.0.0",
        author: "Your Name",
        description: "Plugin description",
        icon: "COG"
    };

    get metadata(): PluginMetadata {
        return this._metadata;
    }

    init(): void {
        this.log("Plugin initialized!");
    }

    render(): string {
        return "<div>Hello World</div>";
    }
}
```

Use the AI Coding Agent in the editor to generate plugins automatically!

## Testing

```bash
# Run unit tests
npm run test:unit

# Run e2e tests
npm run test:e2e

# Run all tests
npm test
```

## Documentation

- [AI Coding Agent Documentation](docs/AI_CODING_AGENT.md)
- [FDO SDK Repository](https://github.com/anikitenko/fdo-sdk)

## License

MIT

