-- qmd-reader.lua
-- A Pandoc reader for Quarto Markdown
-- 
-- Copyright (C) 2023 by RStudio, PBC
--
-- Originally by Albert Krewinkel

-- Support the same format extensions as pandoc's Markdown reader
Extensions = pandoc.format.extensions 'markdown'

-- we replace invalid tags with random strings of the same size
-- to safely allow code blocks inside pipe tables
-- note that we can't use uppercase letters here
-- because pandoc canonicalizes classes to lowercase.
function random_string(size)
  local chars = "abcdefghijklmnopqrstuvwxyz"
  local lst = {}
  for _ = 1,size do
    local ix = math.random(1, #chars)
    table.insert(lst, string.sub(chars, ix, ix))
  end
  return table.concat(lst, "")
end

function find_invalid_tags(str)
  -- [^.=\n]
  --   we disallow "." to avoid catching {.python}
  --   we disallow "=" to avoid catching {foo="bar"}
  --   we disallow "\n" to avoid multiple lines

  -- no | in lua patterns...

  -- (c standard, 7.4.1.10, isspace function)
  -- %s catches \n and \r, so we must use [ \t\f\v] instead

  local patterns = {
    "^[ \t\f\v]*(```+[ \t\f\v]*)(%{+[^.=\n\r]*%}+)", 
    "\n[ \t\f\v]*(```+[ \t\f\v]*)(%{+[^.=\n\r]+%}+)"
  }
  function find_it(init)
    for _, pattern in ipairs(patterns) do
      local range_start, range_end, ticks, tag = str:find(pattern, init)
      if range_start ~= nil then
        return range_start, range_end, ticks, tag
      end
    end
    return nil
  end

  local init = 1
  local range_start, range_end, ticks, tag = find_it(init)
  local tag_set = {}
  local tags = {}
  while tag ~= nil do
    init = range_end + 1
    if not tag_set[tag] then
      tag_set[tag] = true
      table.insert(tags, tag)
    end
    range_start, range_end, ticks, tag = find_it(init)
  end
  return tags
end

function escape_invalid_tags(str)
  local tags = find_invalid_tags(str)
  -- we must now replace the tags in a careful order. Specifically,
  -- we can't replace a key that's a substring of a larger key without
  -- first replacing the larger key.
  --
  -- ie. if we replace {python} before {{python}}, Bad Things Happen.
  -- so we sort the tags by descending size, which suffices
  table.sort(tags, function(a, b) return #b < #a end)

  local replacements = {}
  for _, k in ipairs(tags) do
    local replacement
    local attempts = 1
    repeat
      replacement = random_string(#k)
      attempts = attempts + 1
    until str:find(replacement, 1, true) == nil or attempts == 100
    if attempts == 100 then
      print("Internal error, could not find safe replacement for "..k.." after 100 tries")
      print("Please file a bug at https://github.com/quarto-dev/quarto-cli")
      os.exit(1)
    end
    replacements[replacement] = k
    print(replacement, k)
    local patterns = {"^([ \t\f\v]*```+[ \t\f\v]*)" .. k, "(\n[ \t\f\v]*```+[ \t\f\v]*)" .. k}
    str = str:gsub(patterns[1], "%1" .. replacement):gsub(patterns[2], "%1" .. replacement)
  end
  return str, replacements
end

function unescape_invalid_tags(str, tags)
  for replacement, k in pairs(tags) do
    str = str:gsub(replacement, k)
  end
  return str
end

function Reader (inputs, opts)
  local txt, tags = escape_invalid_tags(tostring(inputs))
  local extensions = {}

  for k, v in pairs(opts.extensions) do
    extensions[v] = true
  end

  if param("user-defined-from") then
    local user_format = _quarto.format.parse_format(param("user-defined-from"))
    for k, v in pairs(user_format.extensions) do
      extensions[k] = v
    end
  end

  -- Format flavor, i.e., which extensions should be enabled/disabled.
  local flavor = {
    format = "markdown",
    extensions = extensions,
  }
  function restore_invalid_tags(tag)
    return tags[tag] or tag
  end
  local doc = pandoc.read(txt, flavor, opts):walk {
    CodeBlock = function (cb)
      cb.classes = cb.classes:map(restore_invalid_tags)
      cb.text = unescape_invalid_tags(cb.text, tags)
      return cb
    end
  }

  return doc
end