export interface AuctionRow {
  id: string
  season_id: string
  player_id: string
  status: 'open' | 'sold' | 'unsold'
  base_price: number
  current_bid: number
  current_bidder_team_id: string | null
  winning_team_id: string | null
  winning_bid: number | null
  opened_at: string
  closed_at: string | null
}
