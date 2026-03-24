local opt = vim.opt_local
local map = vim.keymap.set

opt.shiftwidth = 2
opt.tabstop = 2
opt.softtabstop = 2
opt.expandtab = true

opt.commentstring = "# %s"

opt.foldmethod = "indent"
opt.foldlevel = 99
opt.foldnestmax = 2

opt.textwidth = 120
opt.colorcolumn = "121"

opt.formatoptions:append("jcroql")

opt.autoindent = true
opt.smartindent = false

local opts = { buffer = true, silent = true }

map("n", "<leader>dm", "odef <cr>end<esc>kA", opts)

map("n", "<leader>dc", "oclass <cr>end<esc>kA", opts)

map("n", "<leader>dm", "odef initialize<cr>end<esc>kA", opts)

map("n", "<leader>am", "oattr_accessor :<esc>a", opts)

map("n", "<leader>ar", "oattr_reader :<esc>a", opts)

map("n", "<leader>aw", "oattr_writer :<esc>a", opts)

map("n", "<leader>bl", "odo<cr>end<esc>kA", opts)

map("n", "<leader>bl", "obegin<cr>rescue => e<cr>end<esc>2kA", opts)

map("n", "<leader>bl", "obegin<cr>rescue => e<cr>ensure<cr>end<esc>3kA", opts)

map("n", "<leader>bl", "obegin<cr>rescue => e<cr>else<cr>ensure<cr>end<esc>4kA", opts)

map("n", "<leader>it", "oif <cr>end<esc>kA", opts)

map("n", "<leader>un", "ounless <cr>end<esc>kA", opts)

map("n", "<leader>cs", "ocase <cr>when <cr>end<esc>2kA", opts)

map("n", "<leader>fo", "ofor  in <cr>end<esc>k^ela", opts)

map("n", "<leader>fe", "o.each do |item|<cr>end<esc>k^A", opts)

map("n", "<leader>fm", "o.map do |item|<cr>end<esc>k^A", opts)

map("n", "<leader>fs", "o.select do |item|<cr>end<esc>k^A", opts)

map("n", "<leader>mu", "omodule <cr>end<esc>kA", opts)

map("n", "<leader>si", "oinclude <esc>a", opts)

map("n", "<leader>si", "oextend <esc>a", opts)

map("n", "<leader>si", "orequire_relative '<esc>a", opts)

map("n", "<leader>gs", "odef self.<cr>end<esc>kA", opts)

map("n", "<leader>ds", 'o"""<cr>"""<esc>O<esc>', opts)

map("n", "<leader>to", "odescribe  do<cr>end<esc>k^f(a", opts)

map("n", "<leader>to", "oit 'does something' do<cr>end<esc>k^", opts)

map("n", "<leader>to", "ocontext 'when condition' do<cr>end<esc>k^", opts)

map("n", "<leader>to", "olet(:) { }<esc>F(a", opts)

map("n", "<leader>to", "osubject { }<esc>F{a", opts)

map("n", "<leader>to", "oexpect {  }.to eq()<esc>F(a", opts)

map("n", "<leader>to", "oallow().to receive(:)<esc>F(a", opts)

map("n", "<leader>pr", "yiwop { p :<c-r>", opts)

map("n", "<leader>pr", "yiwoputs <c-r>\".inspect<esc>", opts)
