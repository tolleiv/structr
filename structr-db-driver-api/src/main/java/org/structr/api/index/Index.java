/**
 * Copyright (C) 2010-2016 Structr GmbH
 *
 * This file is part of Structr <http://structr.org>.
 *
 * Structr is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * Structr is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Structr.  If not, see <http://www.gnu.org/licenses/>.
 */
package org.structr.api.index;

import org.structr.api.QueryResult;
import org.structr.api.search.QueryPredicate;

/**
 *
 */
public interface Index<T> {

	void add(final T t, final String key, final Object value, final Class typeHint);

	void remove(final T t);
	void remove(final T t, final String key);

	QueryResult<T> query(final QueryPredicate predicate);
	QueryResult<T> query(final String key, final Object value, final Class typeHint);
	QueryResult<T> get(final String key, final Object value, final Class typeHint);
}
