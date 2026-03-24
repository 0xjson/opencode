local M = {}

function M.setup(on_attach, capabilities)
	local util = require("lspconfig.util")

	local root_patterns = {
		"composer.json",
		".git",
		"vendor",
		".php-cs-fixer.dist.php",
		"phpunit.xml",
		"phpunit.xml.dist",
	}

	local opts = {
		cmd = { "intelephense", "--stdio" },
		filetypes = { "php", "phtml" },
		root_dir = util.root_pattern(unpack(root_patterns)),
		on_attach = function(client, bufnr)
			on_attach(client, bufnr)
			client.server_capabilities.documentFormattingProvider = true
			client.server_capabilities.documentRangeFormattingProvider = true
		end,
		capabilities = capabilities,
		settings = {
			intelephense = {
				files = {
					maxSize = 5000000,
					associations = { "*.php", "*.phtml" },
					exclude = {
						"**/.git/**",
						"**/node_modules/**",
						"**/vendor/**",
						"**/.idea/**",
						"**/storage/**",
						"**/cache/**",
						"**/build/**",
						"**/dist/**",
					},
				},
				completion = {
					insertUseDeclaration = true,
					fullyQualifyGlobalConstantsAndFunctions = false,
					triggerParameterHints = true,
					maxItems = 100,
				},
				format = {
					enable = true,
				},
				diagnostics = {
					enable = true,
					undefinedTypes = true,
					undefinedFunctions = true,
					undefinedConstants = true,
					undefinedClassConstants = true,
					undefinedMethods = true,
					undefinedProperties = true,
					uninitializedVariables = true,
					typeErrors = true,
					deprecatedErrors = true,
					argumentCountErrors = true,
					duplicateSymbols = true,
					unexpectedTokens = true,
				},
				references = {
					enable = true,
				},
				rename = {
					enable = true,
				},
				workspace = {
					indexLimit = 5000,
				},
				signature = {
					enable = true,
				},
				phpdoc = {
					returnVoid = false,
					useFullyQualifiedNames = false,
				},
				codeLens = {
					enable = true,
					overrides = {
						["intelephense/actions/implementContracts"] = true,
						["intelephense/actions/generateMethodOverride"] = true,
						["intelephense/actions/generateGettersAndSetters"] = true,
					},
				},
				symbols = {
					enable = true,
				},
				codeAction = {
					enable = true,
				},
				codeLensImplementations = {
					enable = true,
				},
				codeLensReferences = {
					enable = true,
				},
				suggest = {
					enable = true,
					suggestFromUse = true,
					suggestFromTraits = true,
				},
				licenseKey = os.getenv("INTELEPHENSE_LICENSE_KEY"),
			},
		},
		init_options = {
			storagePath = vim.fn.stdpath("cache") .. "/intelephense",
			singleQuote = true,
		},
	}

	return {
		name = "intelephense",
		opts = opts,
	}
end

return M
