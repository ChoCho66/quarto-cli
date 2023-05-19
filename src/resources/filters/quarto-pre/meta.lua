-- meta.lua
-- Copyright (C) 2020-2022 Posit Software, PBC

-- inject metadata
function quarto_pre_meta_inject()
  return {
    Meta = function(meta)

      -- FIXME: is _quarto.format.isLatexOutput() needed here?
      --   and if so, isn't it needed below as well?
      
      -- injection awesomebox for captions, if needed
      if quarto_global_state.hasCallouts and _quarto.format.isLatexOutput() then
        metaInjectLatex(meta, function(inject)
          inject(
            usePackageWithOption("tcolorbox", "skins,breakable")
          )
          inject(
            usePackage("fontawesome5")
          )
          inject(
            "\\definecolor{quarto-callout-color}{HTML}{" .. kColorUnknown .. "}\n" ..
            "\\definecolor{quarto-callout-note-color}{HTML}{" .. kColorNote .. "}\n" ..
            "\\definecolor{quarto-callout-important-color}{HTML}{" .. kColorImportant .. "}\n" ..
            "\\definecolor{quarto-callout-warning-color}{HTML}{" .. kColorWarning .."}\n" ..
            "\\definecolor{quarto-callout-tip-color}{HTML}{" .. kColorTip .."}\n" ..
            "\\definecolor{quarto-callout-caution-color}{HTML}{" .. kColorCaution .. "}\n" ..
            "\\definecolor{quarto-callout-color-frame}{HTML}{" .. kColorUnknownFrame .. "}\n" ..
            "\\definecolor{quarto-callout-note-color-frame}{HTML}{" .. kColorNoteFrame .. "}\n" ..
            "\\definecolor{quarto-callout-important-color-frame}{HTML}{" .. kColorImportantFrame .. "}\n" ..
            "\\definecolor{quarto-callout-warning-color-frame}{HTML}{" .. kColorWarningFrame .."}\n" ..
            "\\definecolor{quarto-callout-tip-color-frame}{HTML}{" .. kColorTipFrame .."}\n" ..
            "\\definecolor{quarto-callout-caution-color-frame}{HTML}{" .. kColorCautionFrame .. "}\n"
          )
        end)
      end

      metaInjectLatex(meta, function(inject)
        if quarto_global_state.usingTikz then
          inject(usePackage("tikz"))
        end
      end)


      metaInjectLatex(meta, function(inject)
        if quarto_global_state.usingBookmark then
          inject(
            usePackage("bookmark")
          )    
        end
      end)

      return meta
    end
  }
end

