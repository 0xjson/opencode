local M = {}

function M.setup(on_attach, capabilities)
	local util = require("lspconfig.util")
	local path = util.path

	local root_patterns = { ".git", "pom.xml", "build.gradle", "build.gradle.kts", ".project" }

	local root_markers = { ".git", "pom.xml", "build.gradle", "build.gradle.kts" }

	local opts = {
		cmd = {
			"jdtls",
			"-configuration",
			vim.fn.stdpath("cache") .. "/jdtls/config",
			"-data",
			vim.fn.stdpath("cache") .. "/jdtls/workspace",
		},
		filetypes = { "java" },
		root_dir = util.root_pattern(unpack(root_patterns)),
		on_attach = function(client, bufnr)
			on_attach(client, bufnr)
			client.server_capabilities.documentFormattingProvider = true
			client.server_capabilities.documentRangeFormattingProvider = true
		end,
		capabilities = capabilities,
		settings = {
			java = {
				signatureHelp = { enabled = true },
				contentProvider = { preferred = "fernflower" },
				completion = {
					favoriteStaticMembers = {
						"org.junit.Assert.*",
						"org.junit.Assume.*",
						"org.junit.jupiter.api.Assertions.*",
						"org.junit.jupiter.api.Assumptions.*",
						"org.junit.jupiter.api.DynamicContainer.*",
						"org.junit.jupiter.api.DynamicTest.*",
						"org.mockito.Mockito.*",
						"org.mockito.ArgumentMatchers.*",
						"org.mockito.Answers.*",
					},
					filteredTypes = {
						"com.sun.*",
						"io.micrometer.shaded.*",
						"java.awt.*",
						"jdk.*",
						"sun.*",
					},
					guessMethodArguments = true,
					maxResults = 15,
				},
				codeGeneration = {
					toString = {
						template = "${object.className}{${member.name()}=${member.value}, ${otherMembers}}",
					},
					hashCodeEquals = {
						useJava7Objects = true,
					},
					useBlocks = true,
				},
				configuration = {
					runtimes = {
						{ name = "JavaSE-17", path = "/usr/lib/jvm/java-17-openjdk" },
						{ name = "JavaSE-21", path = "/usr/lib/jvm/java-21-openjdk" },
					},
					updateBuildConfiguration = "interactive",
				},
				format = {
					settings = {
						url = "https://raw.githubusercontent.com/google/styleguide/gh-pages/eclipse-java-google-style.xml",
						profile = "GoogleStyle",
					},
				},
				eclipse = {
					downloadSources = true,
				},
				maven = {
					downloadSources = true,
					downloadJavadoc = true,
				},
				gradle = {
					downloadSources = true,
					downloadJavadoc = true,
				},
				inlayHints = {
					parameterNames = {
						enabled = "all",
						exclusions = {},
					},
				},
				codeLens = {
					enabled = true,
					references = true,
					implementations = true,
					only = true,
				},
				implementationsCodeLens = {
					enabled = true,
				},
				referencesCodeLens = {
					enabled = true,
				},
			},
		},
		init_options = {
			bundles = {},
			extendedClientCapabilities = {
				progressReportProvider = true,
				classFileContentsSupport = true,
				generateToStringPromptSupport = true,
				hashCodeEqualsPromptSupport = true,
				advancedExtractRefactoringSupport = true,
				advancedOrganizeImportsSupport = true,
				generateConstructorsPromptSupport = true,
				generateDelegateMethodsPromptSupport = true,
				moveRefactoringSupport = true,
				inferSelectionSupport = {
					"extractMethod",
					"extractVariable",
					"extractConstant",
				},
			},
		},
	}

	return {
		name = "jdtls",
		opts = opts,
	}
end

return M
