local lsp = {}

function lsp.setup()
	lsp.setup_mason()
	lsp.setup_diagnostics()
	lsp.setup_servers()
	lsp.setup_keymaps()
	lsp.setup_format_on_save()
end

function lsp.setup_mason()
	local ok, mason = pcall(require, "mason")
	if not ok then
		vim.notify("mason.nvim not found", vim.log.levels.WARN)
		return
	end

	mason.setup({
		ui = {
			border = "rounded",
			icons = {
				package_installed = "◍",
				package_pending = "◍",
				package_uninstalled = "◍",
			},
		},
	})

	local ok_mlsp, mason_lspconfig = pcall(require, "mason-lspconfig")
	if not ok_mlsp then
		vim.notify("mason-lspconfig.nvim not found", vim.log.levels.WARN)
		return
	end

	mason_lspconfig.setup({
		ensure_installed = {
			"lua_ls",
			"ruby_lsp",
			"jdtls",
			"intelephense",
			"clangd",
		},
		automatic_installation = true,
	})
end

function lsp.setup_diagnostics()
	local signs = {
		{ name = "DiagnosticSignError", text = "✗" },
		{ name = "DiagnosticSignWarn", text = "⚠" },
		{ name = "DiagnosticSignHint", text = "💡" },
		{ name = "DiagnosticSignInfo", text = "ℹ" },
	}

	for _, sign in ipairs(signs) do
		vim.fn.sign_define(sign.name, { texthl = sign.name, text = sign.text, numhl = "" })
	end

	vim.diagnostic.config({
		virtual_text = {
			prefix = "●",
			spacing = 2,
			source = "if_many",
		},
		signs = {
			active = signs,
		},
		update_in_insert = false,
		underline = true,
		severity_sort = true,
		float = {
			focusable = true,
			style = "minimal",
			border = "rounded",
			source = "always",
			header = "",
			prefix = "",
		},
	})
end

function lsp.setup_servers()
	local ok, lspconfig = pcall(require, "lspconfig")
	if not ok then
		vim.notify("nvim-lspconfig not found", vim.log.levels.WARN)
		return
	end

	local ok_cmp, cmp_nvim_lsp = pcall(require, "cmp_nvim_lsp")
	local capabilities = vim.lsp.protocol.make_client_capabilities()

	if ok_cmp then
		capabilities = cmp_nvim_lsp.default_capabilities(capabilities)
	end

	capabilities.textDocument.codeLens = { dynamicRegistration = false }
	capabilities.textDocument.foldingRange = {
		dynamicRegistration = false,
		lineFoldingOnly = true,
	}

	local on_attach = function(client, bufnr)
		if client.server_capabilities.inlayHintProvider then
			vim.lsp.inlay_hint.enable(true, { bufnr = bufnr })
		end

		if client.server_capabilities.codeLensProvider then
			vim.lsp.codelens.refresh({ bufnr = bufnr })
			vim.api.nvim_create_autocmd({ "BufEnter", "CursorHold", "InsertLeave" }, {
				buffer = bufnr,
				callback = function()
					vim.lsp.codelens.refresh({ bufnr = bufnr })
				end,
			})
		end
	end

	local servers = {
		"ruby",
		"java",
		"php",
		"cpp",
	}

	for _, server in ipairs(servers) do
		local ok_config, config = pcall(require, "lsp.configs." .. server)
		if ok_config then
			local server_config = config.setup(on_attach, capabilities)
			lspconfig[server_config.name or server].setup(server_config.opts or server_config)
		end
	end

	lspconfig.lua_ls.setup({
		on_attach = on_attach,
		capabilities = capabilities,
		settings = {
			Lua = {
				runtime = { version = "LuaJIT" },
				diagnostics = { globals = { "vim" } },
				workspace = {
					library = vim.api.nvim_get_runtime_file("", true),
					checkThirdParty = false,
				},
				telemetry = { enable = false },
			},
		},
	})
end

function lsp.setup_keymaps()
	local map = vim.keymap.set

	vim.api.nvim_create_autocmd("LspAttach", {
		group = vim.api.nvim_create_augroup("UserLspConfig", {}),
		callback = function(ev)
			local opts = { buffer = ev.buf, silent = true }

			map("n", "gd", vim.lsp.buf.definition, opts)
			map("n", "gD", vim.lsp.buf.declaration, opts)
			map("n", "gr", vim.lsp.buf.references, opts)
			map("n", "gi", vim.lsp.buf.implementation, opts)
			map("n", "gt", vim.lsp.buf.type_definition, opts)

			map("n", "K", vim.lsp.buf.hover, opts)
			map("n", "<C-k>", vim.lsp.buf.signature_help, opts)
			map("i", "<C-k>", vim.lsp.buf.signature_help, opts)

			map("n", "<leader>wa", vim.lsp.buf.add_workspace_folder, opts)
			map("n", "<leader>wr", vim.lsp.buf.remove_workspace_folder, opts)
			map("n", "<leader>wl", function()
				print(vim.inspect(vim.lsp.buf.list_workspace_folders()))
			end, opts)

			map("n", "<leader>ds", vim.lsp.buf.document_symbol, opts)
			map("n", "<leader>ws", vim.lsp.buf.workspace_symbol, opts)

			map("n", "<leader>ca", vim.lsp.buf.code_action, opts)
			map("v", "<leader>ca", vim.lsp.buf.code_action, opts)
			map("n", "<leader>rn", vim.lsp.buf.rename, opts)

			map("n", "<leader>cl", vim.lsp.codelens.run, opts)
			map("n", "<leader>cr", vim.lsp.codelens.refresh, opts)

			map("n", "<leader>do", vim.diagnostic.open_float, opts)
			map("n", "<leader>dl", vim.diagnostic.setloclist, opts)
			map("n", "<leader>dq", vim.diagnostic.setqflist, opts)
			map("n", "[d", vim.diagnostic.goto_prev, opts)
			map("n", "]d", vim.diagnostic.goto_next, opts)

			map("n", "<leader>f", function()
				vim.lsp.buf.format({ async = true })
			end, opts)
			map("v", "<leader>f", function()
				vim.lsp.buf.format({ async = true })
			end, opts)

			map("n", "<leader>th", function()
				vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled({}))
			end, opts)
		end,
	})
end

function lsp.setup_format_on_save()
	vim.api.nvim_create_autocmd("BufWritePre", {
		group = vim.api.nvim_create_augroup("LspFormatOnSave", {}),
		pattern = "*",
		callback = function(args)
			local client = vim.lsp.get_clients({ bufnr = args.buf })[1]
			if client and client.server_capabilities.documentFormattingProvider then
				vim.lsp.buf.format({ bufnr = args.buf, async = false })
			end
		end,
	})
end

return lsp
