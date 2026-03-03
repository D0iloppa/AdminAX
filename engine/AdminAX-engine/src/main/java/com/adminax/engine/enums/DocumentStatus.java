/**
 * 
 */
package com.adminax.engine.enums;

/**
 * 
 */
public enum DocumentStatus {
	
	PENDING("PENDING"),
	PROCESSING("PROCESSING"),
    COMPLETED("COMPLETED"),
    FAILED("FAILED"), 
    DOC_PROGRESS("DOC_PROGRESS");

    private final String value;

    DocumentStatus(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }
}