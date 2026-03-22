export const SEARCH_WEB_ECOSYSTEMS = [
    {
        id: "node",
        triggers: ["nodejs", "node.js", "javascript", "typescript", "npm"],
        variantTerms: ["Node.js", "JavaScript SDK"],
        trustedDomains: ["npmjs.com", "github.com", "docs."],
        directUrlTemplates: [
            "https://www.npmjs.com/package/{pkg}",
        ],
        heuristicSources: [
            {
                title: "{title} npm package",
                snippet: "Likely npm package page for {title}.",
                url: "https://www.npmjs.com/package/{pkg}",
            },
        ],
    },
    {
        id: "python",
        triggers: ["python", "pypi"],
        variantTerms: ["Python", "PyPI"],
        trustedDomains: ["pypi.org", "github.com", "docs."],
        directUrlTemplates: [
            "https://pypi.org/project/{pkg}/",
        ],
        heuristicSources: [
            {
                title: "{title} PyPI package",
                snippet: "Likely PyPI package page for {title}.",
                url: "https://pypi.org/project/{pkg}/",
            },
        ],
    },
    {
        id: "go",
        triggers: ["golang", "go"],
        variantTerms: ["Go", "pkg.go.dev"],
        trustedDomains: ["pkg.go.dev", "github.com", "docs."],
        directUrlTemplates: [
            "https://pkg.go.dev/search?q={pkgEncoded}",
        ],
        heuristicSources: [
            {
                title: "{title} Go package",
                snippet: "Likely Go package search page for {title}.",
                url: "https://pkg.go.dev/search?q={pkgEncoded}",
            },
        ],
    },
    {
        id: "rust",
        triggers: ["rust", "cargo", "crates.io"],
        variantTerms: ["Rust", "crates.io"],
        trustedDomains: ["crates.io", "github.com", "docs."],
        directUrlTemplates: [
            "https://crates.io/crates/{pkg}",
        ],
        heuristicSources: [
            {
                title: "{title} crate",
                snippet: "Likely crates.io page for {title}.",
                url: "https://crates.io/crates/{pkg}",
            },
        ],
    },
    {
        id: "java",
        triggers: ["java", "maven", "gradle", "jvm"],
        variantTerms: ["Java", "Maven"],
        trustedDomains: ["mvnrepository.com", "central.sonatype.com", "github.com", "docs."],
        directUrlTemplates: [
            "https://mvnrepository.com/search?q={pkgEncoded}",
        ],
        heuristicSources: [
            {
                title: "{title} Maven package",
                snippet: "Likely Maven search page for {title}.",
                url: "https://mvnrepository.com/search?q={pkgEncoded}",
            },
        ],
    },
    {
        id: "dotnet",
        triggers: ["c#", "csharp", ".net", "dotnet", "nuget"],
        variantTerms: [".NET", "NuGet"],
        trustedDomains: ["nuget.org", "github.com", "docs."],
        directUrlTemplates: [
            "https://www.nuget.org/packages/{pkg}",
        ],
        heuristicSources: [
            {
                title: "{title} NuGet package",
                snippet: "Likely NuGet package page for {title}.",
                url: "https://www.nuget.org/packages/{pkg}",
            },
        ],
    },
    {
        id: "ruby",
        triggers: ["ruby", "rubygems", "gem"],
        variantTerms: ["Ruby", "RubyGems"],
        trustedDomains: ["rubygems.org", "github.com", "docs."],
        directUrlTemplates: [
            "https://rubygems.org/gems/{pkg}",
        ],
        heuristicSources: [
            {
                title: "{title} Ruby gem",
                snippet: "Likely RubyGems page for {title}.",
                url: "https://rubygems.org/gems/{pkg}",
            },
        ],
    },
    {
        id: "php",
        triggers: ["php", "composer", "packagist"],
        variantTerms: ["PHP", "Packagist"],
        trustedDomains: ["packagist.org", "github.com", "docs."],
        directUrlTemplates: [
            "https://packagist.org/search/?query={pkgEncoded}",
        ],
        heuristicSources: [
            {
                title: "{title} Packagist package",
                snippet: "Likely Packagist search page for {title}.",
                url: "https://packagist.org/search/?query={pkgEncoded}",
            },
        ],
    },
];
