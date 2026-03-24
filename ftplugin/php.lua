local opt = vim.opt_local
local map = vim.keymap.set

opt.shiftwidth = 4
opt.tabstop = 4
opt.softtabstop = 4
opt.expandtab = true

opt.commentstring = "// %s"

opt.foldmethod = "indent"
opt.foldlevel = 99
opt.foldnestmax = 2

opt.textwidth = 120
opt.colorcolumn = "121"

opt.formatoptions:append("jcroql")

opt.autoindent = true
opt.smartindent = false

local opts = { buffer = true, silent = true }

map("n", "<leader>ph", "i<?php<cr><esc>", opts)

map("n", "<leader>cl", "oclass  {<cr>}<esc>k^f{a", opts)

map("n", "<leader>fn", "ofunction ():  {<cr>}<esc>k^f(i", opts)

map("n", "<leader>fn", "opublic function ():  {<cr>}<esc>k^f(i", opts)

map("n", "<leader>fn", "oprivate function ():  {<cr>}<esc>k^f(i", opts)

map("n", "<leader>fn", "opublic function __construct() {<cr>}<esc>k^f(i", opts)

map("n", "<leader>fn", "opublic static function ():  {<cr>}<esc>k^f(i", opts)

map("n", "<leader>fn", "opublic function get():  {<cr>return $this->;<cr>}<esc>2k^f$a", opts)

map("n", "<leader>fn", "opublic function set($): self {<cr>$this-> = $;<cr>return $this;<cr>}<esc>3k^f(i", opts)

map("n", "<leader>ns", "onamespace ;<esc>A", opts)

map("n", "<leader>us", "ouse ;<esc>A", opts)

map("n", "<leader>ex", "oextends <esc>a", opts)

map("n", "<leader>im", "oimplements <esc>a", opts)

map("n", "<leader>tr", "otrait  {<cr>}<esc>k^f{a", opts)

map("n", "<leader>us", "ouse ;<esc>0f;a", opts)

map("n", "<leader>fo", "ofor ($i = 0; $i < ; $i++) {<cr>}<esc>k^f<la", opts)

map("n", "<leader>fe", "oforeach ($ as $) {<cr>}<esc>k^f$a", opts)

map("n", "<leader>wh", "owhile () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>do", "odo {<cr>} while ();<esc>k^f(i", opts)

map("n", "<leader>if", "oif () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>if", "oif () {<cr>} else {<cr>}<esc>2k^f(i", opts)

map("n", "<leader>sw", "oswitch () {<cr>case '':<cr>break;<cr>default:<cr>break;<cr>}<esc>4k^f(i", opts)

map("n", "<leader>tr", "otry {<cr>} catch (Exception $e) {<cr>}<esc>2k^", opts)

map("n", "<leader>tr", "otry {<cr>} catch (Exception $e) {<cr>} finally {<cr>}<esc>3k^", opts)

map("n", "<leader>ar", "o[$ => ]<esc>F[a", opts)

map("n", "<leader>pr", "o$ = ;<esc>F$la", opts)

map("n", "<leader>pr", "oecho ;<esc>a", opts)

map("n", "<leader>pr", "oprint_r();<esc>hi", opts)

map("n", "<leader>pr", "ovar_dump();<esc>hi", opts)

map("n", "<leader>pr", "oerror_log();<esc>hi", opts)

map("n", "<leader>pr", "oexit;<esc>", opts)

map("n", "<leader>pr", "odie();<esc>hi", opts)

map("n", "<leader>nv", "o$_GET['']<esc>hi", opts)

map("n", "<leader>nv", "o$_POST['']<esc>hi", opts)

map("n", "<leader>nv", "o$_SESSION['']<esc>hi", opts)

map("n", "<leader>nv", "o$_SERVER['']<esc>hi", opts)

map("n", "<leader>nv", "o$_REQUEST['']<esc>hi", opts)

map("n", "<leader>co", "o// <esc>a", opts)

map("n", "<leader>co", "o/*<cr>*/<esc>O<esc>", opts)

map("n", "<leader>co", "o/**<cr> * <cr> */<esc>O<esc>", opts)

map("n", "<leader>fu", "o__FUNCTION__<esc>", opts)

map("n", "<leader>li", "o__LINE__<esc>", opts)

map("n", "<leader>fi", "o__FILE__<esc>", opts)

map("n", "<leader>cl", "o__CLASS__<esc>", opts)

map("n", "<leader>me", "o__METHOD__<esc>", opts)

map("n", "<leader>te", "ofunction test() {<cr>}<esc>k^ftla", opts)

map("n", "<leader>te", "o$this->assertTrue();<esc>hi", opts)

map("n", "<leader>te", "o$this->assertEquals(, );<esc>F,la", opts)

map("n", "<leader>te", "o$this->expectException(::class);<esc>^f(a", opts)
