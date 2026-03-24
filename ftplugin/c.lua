local opt = vim.opt_local
local map = vim.keymap.set

opt.shiftwidth = 4
opt.tabstop = 4
opt.softtabstop = 4
opt.expandtab = false
opt.noexpandtab = true

opt.commentstring = "// %s"

opt.foldmethod = "syntax"
opt.foldlevel = 99

opt.textwidth = 100
opt.colorcolumn = "101"

opt.formatoptions:append("jcroql")

opt.cindent = true
opt.autoindent = true

local opts = { buffer = true, silent = true }

map("n", "<leader>in", "o#include <><esc>hi", opts)

map("n", "<leader>in", "o#include \"\"<esc>hi", opts)

map("n", "<leader>df", "oint main(int argc, char *argv[]) {<cr>return 0;<cr>}<esc>2k^", opts)

map("n", "<leader>df", "ovoid () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>st", "ostruct  {<cr>};<esc>k^f{a", opts)

map("n", "<leader>un", "ounion  {<cr>};<esc>k^f{a", opts)

map("n", "<leader>ty", "otypedef struct {<cr>} ;<esc>k^f{a", opts)

map("n", "<leader>ty", "otypedef enum {<cr>} ;<esc>k^f{a", opts)

map("n", "<leader>en", "oenum  {<cr>};<esc>k^f{a", opts)

map("n", "<leader>pr", "oprintf(\"\\n\");<esc>F\\i", opts)

map("n", "<leader>pr", "oprintf(\"%s\\n\", );<esc>F,la", opts)

map("n", "<leader>pr", "oprintf(\"%d\\n\", );<esc>F,la", opts)

map("n", "<leader>sc", "oscanf(\"%s\", &);<esc>F%la", opts)

map("n", "<leader>fo", "ofor (int i = 0; i < ; i++) {<cr>}<esc>k^f<la", opts)

map("n", "<leader>wh", "owhile () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>do", "odo {<cr>} while ();<esc>k^f(i", opts)

map("n", "<leader>if", "oif () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>if", "oif () {<cr>} else {<cr>}<esc>2k^f(i", opts)

map("n", "<leader>sw", "oswitch () {<cr>case :<cr>break;<cr>default:<cr>break;<cr>}<esc>4k^f(i", opts)

map("n", "<leader>ma", "o#define <esc>a", opts)

map("n", "<leader>if", "o#ifdef <cr>#endif<esc>k^fa", opts)

map("n", "<leader>if", "o#ifndef <cr>#define <cr><cr>#endif<esc>3k^fa", opts)

map("n", "<leader>ma", "o#define NULL ((void*)0)<esc>", opts)

map("n", "<leader>ma", "o#define true 1<cr>#define false 0<esc>", opts)

map("n", "<leader>ma", "o#define min(a, b) ((a) < (b) ? (a) : (b))<esc>", opts)

map("n", "<leader>ma", "o#define max(a, b) ((a) > (b) ? (a) : (b))<esc>", opts)

map("n", "<leader>hd", "o#ifndef _H<cr>#define _H<cr><cr>#endif<esc>3k^f_f{a", opts)

map("n", "<leader>me", "omalloc(sizeof())<esc>F(a", opts)

map("n", "<leader>me", "omalloc(sizeof() * )<esc>F(a", opts)

map("n", "<leader>fr", "ofree();<esc>hi", opts)

map("n", "<leader>ar", "ochar *[100];<esc>F[a", opts)

map("n", "<leader>sz", "osizeof()<esc>i", opts)

map("n", "<leader>fi", "oFILE *fp = fopen(\"\", \"\");<esc>F\"F\"2h", opts)

map("n", "<leader>fi", "oif (fp == NULL) {<cr>perror(\"\");<cr>exit(1);<cr>}<esc>3k^", opts)

map("n", "<leader>fi", "ochar buffer[1024];<cr>while (fgets(buffer, sizeof(buffer), fp)) {<cr>}<esc>k^", opts)

map("n", "<leader>fi", "ofclose(fp);<esc>", opts)
