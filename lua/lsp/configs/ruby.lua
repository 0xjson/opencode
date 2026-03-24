local M = {}

function M.setup(on_attach, capabilities)
	local util = require("lspconfig.util")

	local root_patterns = { "Gemfile", ".ruby-version", "Gemfile.lock", ".git" }

	local settings = {
		ruby_lsp = {
			formatter = "auto",
			linters = { "rubocop" },
			diagnostics = true,
			codeAction = true,
			codeLens = {
				enable = true,
				gemfileLinks = true,
				references = true,
			},
			completion = {
				enable = true,
				autoRequire = true,
			},
			inlayHints = {
				enable = true,
				implicitRescueReturn = true,
				implicitArrayReturn = true,
			},
		},
	}

	local opts = {
		cmd = { "ruby-lsp" },
		filetypes = { "ruby", "eruby", "rb" },
		root_dir = util.root_pattern(unpack(root_patterns)),
		on_attach = function(client, bufnr)
			on_attach(client, bufnr)
			client.server_capabilities.documentFormattingProvider = true
			client.server_capabilities.documentRangeFormattingProvider = true
		end,
		capabilities = capabilities,
		settings = settings,
		init_options = {
			formatter = "auto",
			linters = { "rubocop" },
			diagnostics = true,
		},
	}

	return {
		name = "ruby_lsp",
		opts = opts,
	}
end

return M
