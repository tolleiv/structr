/**
 * Copyright (C) 2010-2014 Morgner UG (haftungsbeschränkt)
 *
 * This file is part of Structr <http://structr.org>.
 *
 * Structr is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * Structr is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Structr.  If not, see <http://www.gnu.org/licenses/>.
 */
package org.structr.schema.parser;

import org.structr.schema.SchemaHelper;

/**
 *
 * @author Christian Morgner
 */
public class Validator {

	private String validator    = null;
	private String className    = null;
	private String propertyName = null;

	public Validator(final String validator, final String className, final String propertyName) {

		this.validator    = validator;
		this.className    = className;
		this.propertyName = propertyName;
	}

	public String getSource(final String obj, final boolean includeClassName) {

		StringBuilder buf = new StringBuilder();

		buf.append("ValidationHelper.").append(validator).append("(").append(obj).append(", ");

		if (includeClassName) {
			buf.append(className).append(".");
		}

		buf.append(SchemaHelper.cleanPropertyName(propertyName)).append("Property");
		buf.append(", errorBuffer)");

		return buf.toString();
	}
}