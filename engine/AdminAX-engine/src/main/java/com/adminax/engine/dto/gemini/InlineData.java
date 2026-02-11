/**
 * 
 */
package com.adminax.engine.dto.gemini;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 
 */
public class InlineData {
    @JsonProperty("mime_type") //
    private String mimeType;

    @JsonProperty("data")
    private String data;

    public InlineData() {}
    public InlineData(String mimeType, String data) {
        this.mimeType = mimeType;
        this.data = data;
    }
    public String getMimeType() { return mimeType; }
    public void setMimeType(String mimeType) { this.mimeType = mimeType; }
    public String getData() { return data; }
    public void setData(String data) { this.data = data; }
}
