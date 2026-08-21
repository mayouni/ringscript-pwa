# A minimal world for the stream contract test: it holds a list of order
# ids, applies a snapshot by REPLACING (Law 2: clear, then load -- never
# merge), and reconciles by returning every locally-held id the snapshot
# did not confirm (Law 3: orphans are dropped, with an event, never left
# to trap the user).

aSnapOrders = []
aSnapGhosts = []

# seed a locally-restored order, as a page restoring a past session would
func SnapSeed cId
	aSnapOrders + cId
	return len(aSnapOrders)

# the snapshot arrives as {"orders":["srv-1", ...]} -- clear, then load
func SnapApply cJson
	aDoc = JsonDecode(cJson)
	aNew = []
	for i = 1 to len(aDoc)
		if aDoc[i][1] = "orders"
			aNew = aDoc[i][2]
		ok
	next
	aSnapGhosts = []
	for i = 1 to len(aSnapOrders)
		if find(aNew, aSnapOrders[i]) = 0
			aSnapGhosts + aSnapOrders[i]
		ok
	next
	aSnapOrders = aNew          # REPLACED, not merged
	return JsonEncode([ :ok = 1, :held = len(aSnapOrders) ])

# ids the snapshot did not confirm -- computed during apply, handed back here
func SnapReconcile p
	return JsonEncode(aSnapGhosts)

func SnapHeld p
	return JsonEncode(aSnapOrders)
