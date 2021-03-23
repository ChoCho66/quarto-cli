-- html.lua
-- Copyright (C) 2021 by RStudio, PBC

-- required version
PANDOC_VERSION:must_be_at_least '2.13'

-- initialize random number generator (used for tabset ids)
math.randomseed(os.time())

-- make images responsive (unless they have an explicit height attribute)
Image = function(image)
  if not image.attr.attributes["height"] then
    image.attr.classes:insert("img-fluid")
    return image
  end
end

-- tabsets and notices
Div = function(div)
  if div.attr.classes:find("admonition") then
    return noticeDiv(div)
  elseif div.attr.classes:find("tabset") then
    return tabsetDiv(div)
  end  
end


function noticeDiv(div)
  -- capture type information
  local type = div.attr.attributes["type"] 
  if type == nil then
    type = "info"
  end

  -- capture caption information
  local caption = div.attr.attributes["caption"]
  div.attr.attributes["caption"] = nil

  -- Make an outer card div and transfer classes
  local cardDiv = pandoc.Div({})
  cardDiv.attr.classes = div.attr.classes:clone()
  div.attr.classes = pandoc.List:new() 

  -- add card attributes
  cardDiv.attr.classes:insert("card")
  
  -- create a card header
  if caption ~= nil then
    local cardHeaderDiv = pandoc.Div({})
    cardHeaderDiv.attr.classes:insert("card-header")
    cardHeaderDiv.content:insert(pandoc.Plain(type))
    cardDiv.content:insert(cardHeaderDiv)
  end

  -- create a card body
  div.attr.classes:insert("card-body")
  cardDiv.content:insert(div)
  
  return cardDiv
end


function tabsetDiv(div)

  -- create a unique id for the tabset
  local tabsetid = "tabset-" .. math.random(100000)

  -- find the first heading in the tabset
  local heading = div.content:find_if(function(el) return el.t == "Header" end)
  if heading ~= nil then
    -- note the level, then build tab buckets for content after these levels
    local level = heading.level
    local tabs = pandoc.List:new()
    local tab = nil
    for i=1,#div.content do 
      local el = div.content[i]
      if el.t == "Header" and el.level == level then
        tab = pandoc.Div({})
        tab.content:insert(el)
        tabs:insert(tab)
      elseif tab ~= nil then
        tab.content:insert(el)
      end
    end

    -- init tab navigation 
    local nav = pandoc.List:new()
    nav:insert(pandoc.RawInline('html', '<ul class="nav nav-tabs mb-3" role="tablist">'))

    -- init tab panes
    local panes = pandoc.Div({}, div.attr)
    panes.attr.classes = div.attr.classes:map(function(class) 
      if class == "tabset" then
        return "tab-content" 
      else
        return name
      end
    end)
   
    -- populate
    for i=1,#tabs do
      -- alias tab and heading
      local tab = tabs[i]
      local heading = tab.content[1]
      tab.content:remove(1)

      -- tab id
      local tabid = tabsetid .. "-" .. i
      local tablinkid = tabid .. "-tab"

      -- navigation
      local active = ""
      local selected = "false"
      if i==1 then
        active = " active"
        selected = "true"
      end
      nav:insert(pandoc.RawInline('html', '<li class="nav-item" role="presentation">'))
      nav:insert(pandoc.RawInline('html', '<a class="nav-link' .. active .. '" id="' .. tablinkid .. '" data-bs-toggle="tab" data-bs-target="#' .. tabid .. '" role="tab" aria-controls="' .. tabid .. '" aria-selected="' .. selected .. '">'))
      nav:extend(heading.content)
      nav:insert(pandoc.RawInline('html', '</a></li>'))

      -- pane
      local pane = pandoc.Div({}, heading.attr)
      pane.attr.identifier = tabid
      pane.attr.classes:insert("tab-pane")
      if i==1 then
        pane.attr.classes:insert("active")
      end
      pane.attr.attributes["role"] = "tabpanel"
      pane.attr.attributes["aria-labeledby"] = tablinkid
      pane.content:extend(tab.content)
      panes.content:insert(pane)
    end

    -- end tab navigation
    nav:insert(pandoc.RawInline('html', '</ul>'))

    -- return tabset
    return pandoc.List({
      pandoc.Plain(nav),
      panes
    })

  end 
end