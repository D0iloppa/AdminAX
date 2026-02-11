/**
 * 
 */
package com.adminax.engine.dto.gemini;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Part {
    @JsonProperty("text")
    private String text;

    @JsonProperty("inlineData") //
    private InlineData inlineData;

    public Part() {}
    public static Part fromText(String text) {
        Part part = new Part();
        part.text = text;
        return part;
    }
    public static Part fromInlineData(InlineData inlineData) {
        Part part = new Part();
        part.inlineData = inlineData;
        return part;
    }
    public String getText() { return text; }
    public void setText(String text) { this.text = text; }
    public InlineData getInlineData() { return inlineData; }
    public void setInlineData(InlineData inlineData) { this.inlineData = inlineData; }
}
