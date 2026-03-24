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

opt.suffixesadd = ".cpp,.hpp,.h,.cc,.cxx,.c++"

local opts = { buffer = true, silent = true }

map("n", "<leader>in", "o#include <><esc>hi", opts)

map("n", "<leader>in", "o#include \"\"<esc>hi", opts)

map("n", "<leader>ns", "ousing namespace ;<esc>ha", opts)

map("n", "<leader>cl", "oclass  {<cr>public:<cr>private:<cr>};<esc>3k^f{a", opts)

map("n", "<leader>st", "ostruct  {<cr>};<esc>k^f{a", opts)

map("n", "<leader>cl", "oclass :: public <cr>{<cr>public:<cr>();<cr>~();<cr>};<esc>5k^f{a", opts)

map("n", "<leader>fn", "ovoid () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>fn", "o () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>co", "o::(const & other) {<cr>}<esc>k^f(i", opts)

map("n", "<leader>co", "o& operator=(const & other) {<cr>if (this != &other) {<cr>}<cr>return *this;<cr>}<esc>4k^f(i", opts)

map("n", "<leader>op", "ofriend std::ostream& operator<<(std::ostream& os, const & obj);<esc>^f&a", opts)

map("n", "<leader>op", "ofriend std::istream& operator>>(std::istream& is, & obj);<esc>^f&a", opts)

map("n", "<leader>cp", "otemplate <typename T><cr>T () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>en", "oenum class  {<cr>};<esc>k^f{a", opts)

map("n", "<leader>fn", "oauto  = []() ->  {<cr>};<esc>k^f=a", opts)

map("n", "<leader>fn", "oauto  = [](auto ) -> auto {<cr>return ;<cr>};<esc>2k^f=a", opts)

map("n", "<leader>co", "o// <esc>a", opts)

map("n", "<leader>co", "o/*<cr>*/<esc>O<esc>", opts)

map("n", "<leader>hd", "o#pragma once<cr><cr>" , opts)

map("n", "<leader>hd", "o#ifndef _H<cr>#define _H<cr><cr>#endif<esc>3k^f_f{a", opts)

map("n", "<leader>hd", "o#include <iostream><cr>" , opts)

map("n", "<leader>hd", "o#include <vector><cr>" , opts)

map("n", "<leader>hd", "o#include <string><cr>" , opts)

map("n", "<leader>hd", "o#include <algorithm><cr>" , opts)

map("n", "<leader>hd", "o#include <memory><cr>" , opts)

map("n", "<leader>fo", "ofor (int i = 0; i < ; ++i) {<cr>}<esc>k^f<la", opts)

map("n", "<leader>fr", "ofor (auto&  : ) {<cr>}<esc>k^f:a", opts)

map("n", "<leader>wh", "owhile () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>do", "odo {<cr>} while ();<esc>k^f(i", opts)

map("n", "<leader>if", "oif () {<cr>}<esc>k^f(i", opts)

map("n", "<leader>if", "oif () {<cr>} else {<cr>}<esc>2k^f(i", opts)

map("n", "<leader>sw", "oswitch () {<cr>case :<cr>break;<cr>default:<cr>break;<cr>}<esc>4k^f(i", opts)

map("n", "<leader>tr", "otry {<cr>} catch (const std::exception& e) {<cr>std::cerr << e.what() << std::endl;<cr>}<esc>3k^", opts)

map("n", "<leader>tr", "otry {<cr>} catch (...) {<cr>}<esc>2k^", opts)

map("n", "<leader>cm", "othrow std::runtime_error(\"\");<esc>2hi", opts)

map("n", "<leader>pr", "ostd::cout <<  << std::endl;<esc>F<la", opts)

map("n", "<leader>pr", "ostd::cerr <<  << std::endl;<esc>F<la", opts)

map("n", "<leader>ve", "ostd::vector<> ;<esc>F<a", opts)

map("n", "<leader>sh", "ostd::shared_ptr<> ;<esc>F<a", opts)

map("n", "<leader>up", "ostd::unique_ptr<> ;<esc>F<a", opts)

map("n", "<leader>st", "ostd::string ;<esc>ha", opts)

map("n", "<leader>at", "ostatic_assert();<esc>hi", opts)

map("n", "<leader>st", "ostatic ;<esc>ha", opts)

map("n", "<leader>cx", "oextern \"C\" {<cr>}<esc>k^", opts)

map("n", "<leader>us", "ousing ;<esc>ha", opts)

map("n", "<leader>us", "ousing std::;<esc>ha", opts)

map("n", "<leader>mm", "odelete ;<esc>ha", opts)

map("n", "<leader>mm", "odelete[] ;<esc>ha", opts)

map("n", "<leader>mm", "onew <esc>a", opts)

map("n", "<leader>mm", "onew [<esc>a", opts)

map("n", "<leader>mm", "ostd::make_unique<>();<esc>F<a", opts)

map("n", "<leader>mm", "ostd::make_shared<>();<esc>F<a", opts)

map("n", "<leader>mu", "ostd::move()<esc>i", opts)

map("n", "<leader>mu", "ostd::forward<decltype()>()<esc>Ffa", opts)

map("n", "<leader>co", "oconstexpr <esc>a", opts)

map("n", "<leader>co", "oconstexpr auto  = ;<esc>F=la", opts)

map("n", "<leader>no", "onoexcept<esc>a", opts)

map("n", "<leader>no", "onoexcept(true)<esc>", opts)

map("n", "<leader>ov", "ooverride<esc>", opts)

map("n", "<leader>fn", "ofinal<esc>", opts)

map("n", "<leader>de", "odefault<esc>", opts)

map("n", "<leader>de", "odefault:<esc>" , opts)

map("n", "<leader>de", "odelete<esc>", opts)

map("n", "<leader>de", "o= delete;<esc>", opts)

map("n", "<leader>de", "o= default;<esc>", opts)
