export default function unlink( here ) {
	let ln = this._links[ here ];

	if ( ln ) {
		ln.unlink();
		delete this._links[ here ];
		return this.set( here, ln.intialValue );
	}
}
