local M = {}

function M.setup(on_attach, capabilities)
	local util = require("lspconfig.util")

	local root_patterns = {
		".git",
		".clangd",
		"compile_commands.json",
		"CMakeLists.txt",
		".clang-tidy",
		".clang-format",
		"configure.ac",
		"configure.in",
	}

	local opts = {
		cmd = {
			"clangd",
			"--background-index",
			"--clang-tidy",
			"--header-insertion=iwyu",
			"--completion-style=bundled",
			"--pch-storage=memory",
			"--cross-file-rename",
			"--all-scopes-completion",
			"--log=error",
		},
		filetypes = { "c", "cpp", "objc", "objcpp", "cuda", "proto" },
		root_dir = util.root_pattern(unpack(root_patterns)),
		on_attach = function(client, bufnr)
			on_attach(client, bufnr)
			client.server_capabilities.documentFormattingProvider = true
			client.server_capabilities.documentRangeFormattingProvider = true
		end,
		capabilities = capabilities,
		settings = {
			clangd = {
				checkUpdates = false,
				completion = {
					placeholder = true,
					snippetsSupport = true,
				},
				diagnostics = {
					enable = true,
				},
				index = {
					enable = true,
					background = true,
					threads = 0,
				},
				suggest = {
					completeFunctions = true,
					includeIneligibleResults = false,
				},
				signatureHelp = {
					enable = true,
				},
				semanticHighlighting = {
					enable = true,
				},
				inlayHints = {
					enable = true,
					designator = true,
					parameterNames = true,
					 DeducedTypes = true,
				},
				fallbackFlags = {},
			},
		},
		init_options = {
			clangdFileStatus = true,
			usePlaceholders = true,
			completeUnimported = true,
			semanticHighlighting = true,
			inlayHints = {
				parameterNames = true,
				parameterTypes = true,
				DeducedTypes = true,
				designator = true,
			},
		},
	}

	return {
		name = "clangd",
		opts = opts,
	}
end

return M
