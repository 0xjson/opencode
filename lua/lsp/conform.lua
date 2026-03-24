local M = {}

function M.setup()
	local ok, conform = pcall(require, "conform")
	if not ok then
		vim.notify("conform.nvim not found", vim.log.levels.WARN)
		return
	end

	conform.setup({
		formatters_by_ft = {
			lua = { "stylua" },
			python = { "isort", "black" },
			javascript = { "prettierd", "prettier", stop_after_first = true },
			typescript = { "prettierd", "prettier", stop_after_first = true },
			javascriptreact = { "prettierd", "prettier", stop_after_first = true },
			typescriptreact = { "prettierd", "prettier", stop_after_first = true },
			ruby = { "rubocop" },
			java = { "google-java-format" },
			php = { "php_cs_fixer" },
			c = { "clang-format" },
			cpp = { "clang-format" },
			go = { "gofmt", "goimports" },
			rust = { "rustfmt" },
			markdown = { "prettier" },
			yaml = { "prettier" },
			json = { "prettier" },
			html = { "prettier" },
			css = { "prettier" },
			scss = { "prettier" },
		},
		format_on_save = {
			timeout_ms = 500,
			lsp_fallback = true,
		},
		formatters = {
			stylua = {
				command = "stylua",
				args = { "--search-parent-directories", "--stdin-filepath", "$FILENAME", "-" },
			},
			rubocop = {
				command = "rubocop",
				args = { "--autocorrect", "--stdin", "$FILENAME", "--format", "simple", "--stderr" },
				stdin = true,
			},
			["google-java-format"] = {
				command = "google-java-format",
				args = { "--aosp", "-" },
				stdin = true,
			},
			php_cs_fixer = {
				command = "php-cs-fixer",
				args = { "fix", "--using-cache=no", "--no-interaction", "$FILENAME" },
				stdin = false,
			},
			["clang-format"] = {
				command = "clang-format",
				args = { "--assume-filename=$FILENAME" },
				stdin = true,
			},
		},
	})
end

return M
